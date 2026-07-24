import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useTimeFormat, formatTime } from "@/hooks/useTimeFormat";
import { useTimezone, TIMEZONE_OPTIONS, AUTO_TZ } from "@/hooks/useTimezone";
import { recordBrokerConnection } from "@/lib/broker.functions";
import { exportMyData, deleteMyAccount } from "@/lib/privacy.functions";
import { createPortalSession, getMySubscription } from "@/lib/billing.functions";
import { setRecoveryCode, hasRecoveryCode } from "@/lib/recovery.functions";
import { generateRecoveryCode } from "@/lib/recoveryCode";
import { toast } from "sonner";

import {
  Plug,
  ShieldCheck,
  User as UserIcon,
  Eye,
  CreditCard,
  ExternalLink,
  Monitor,
  Save,
  XCircle,
  AlertCircle,
  Volume2,
  VolumeX,
  Download,
  Trash2,
  KeyRound,
  Copy,
  Mail,
  Palette,
  RotateCcw,
} from "lucide-react";
import { isWelcomeBackMuted, setWelcomeBackMuted } from "@/lib/welcomeBack";
import { useCandleColors, type CandleColors } from "@/hooks/useCandleColors";
import { useChartBackground, CHART_BG_PRESETS, type ChartBackground } from "@/hooks/useChartBackground";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings, TradeMind" }] }),
  component: SettingsPage,
});

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 my-8">
      <span className="text-[11px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
        {children}
      </span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card/40 p-6 ${className}`}>
      {children}
    </div>
  );
}

function FieldLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium mb-2">
      {icon}
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full h-11 rounded-lg bg-background/60 border border-border px-3.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 ${props.className ?? ""}`}
    />
  );
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-11 rounded-lg bg-background/60 border border-border px-3.5 text-sm focus:outline-none focus:border-primary/50 appearance-none bg-no-repeat bg-[right_0.75rem_center] ${props.className ?? ""}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
      }}
    >
      {children}
    </select>
  );
}

function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-background/60 border border-border text-sm font-medium hover:border-primary/40 transition ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

type TLAccount = { id: string | number; accNum?: string | number; name?: string; balance?: number; currency?: string; status?: string };
type TLTrade = { id: string; date: string; timeframe: string; symbol: string; side: "Long" | "Short"; entry: number; exit: number; stop: number; size: number; notes: string; createdAt: number };
const JOURNAL_KEY = "trademind.journal.trades.v1";
const TL_CREDS_KEY = "trademind.tradelocker.creds.v1";

function SettingsPage() {
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);
  const { profile, refresh } = useProfile();
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const { format: timeFormat, setFormat: setTimeFormat } = useTimeFormat();
  const { timezone, resolvedTimezone, setTimezone } = useTimezone();
  const detectedTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [clockNow, setClockNow] = useState(() => new Date());
  const [welcomeMuted, setWelcomeMutedState] = useState(false);
  useEffect(() => { setWelcomeMutedState(isWelcomeBackMuted()); }, []);
  const { colors: candleColors, update: updateCandleColors, reset: resetCandleColors, isHex } = useCandleColors();
  const { colors: chartBg, update: updateChartBg, setPreset: setChartBgPreset, reset: resetChartBg } = useChartBackground();

  // TradeLocker integration state
  const [tlEmail, setTlEmail] = useState("");
  const [tlPassword, setTlPassword] = useState("");
  const [tlServer, setTlServer] = useState("OSP-DEMO");
  const [tlAccountType, setTlAccountType] = useState<"demo" | "live">("demo");
  const [tlBusy, setTlBusy] = useState<"" | "test" | "import">("");
  const [tlAccounts, setTlAccounts] = useState<TLAccount[]>([]);
  const [tlAccountId, setTlAccountId] = useState<string>("");
  const [tlConnected, setTlConnected] = useState(false);

  // Privacy / GDPR
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const runExport = useServerFn(exportMyData);
  const runDelete = useServerFn(deleteMyAccount);

  const recordBroker = useServerFn(recordBrokerConnection);

  // Recovery code
  const runSetRecovery = useServerFn(setRecoveryCode);
  const runHasRecovery = useServerFn(hasRecoveryCode);
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState(false);
  const [emailingCode, setEmailingCode] = useState(false);

  useEffect(() => {
    runHasRecovery({ data: undefined })
      .then((r) => setHasCode(r.hasCode))
      .catch(() => setHasCode(false));
  }, [runHasRecovery]);

  async function generateAndSaveCode() {
    setSavingCode(true);
    try {
      const code = generateRecoveryCode();
      await runSetRecovery({ data: { code } });
      setNewCode(code);
      setHasCode(true);
      toast.success("Recovery code generated. Save it now.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate code");
    } finally {
      setSavingCode(false);
    }
  }

  async function copyCode() {
    if (!newCode) return;
    try {
      await navigator.clipboard.writeText(newCode);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function emailCode() {
    if (!newCode || !profile?.email) return;
    setEmailingCode(true);
    try {
      const subjectRaw = "Your TradeMind recovery code";
      const bodyRaw = `Keep this somewhere safe. You can use it to reset your TradeMind password if you ever lose access.\n\nRecovery code: ${newCode}\n\nDo not share this with anyone.`;
      const subject = encodeURIComponent(subjectRaw);
      const body = encodeURIComponent(bodyRaw);
      const mailto = `mailto:${profile.email}?subject=${subject}&body=${body}`;
      const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(profile.email)}&su=${subject}&body=${body}`;

      // Try to open the OS default mail client via an anchor click (more reliable than
      // window.location.href, which silently no-ops when no handler is registered).
      const a = document.createElement("a");
      a.href = mailto;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Fallback for users without a desktop mail handler: open Gmail's compose window
      // and copy the code so they can paste it into whichever mail app they use.
      window.open(gmail, "_blank", "noopener,noreferrer");
      try {
        await navigator.clipboard.writeText(
          `To: ${profile.email}\nSubject: ${subjectRaw}\n\n${bodyRaw}`,
        );
        toast.success("Draft opened. Code copied to clipboard as a backup.");
      } catch {
        toast.success("Draft opened in a new tab.");
      }
    } finally {
      setEmailingCode(false);
    }
  }


  useEffect(() => {

    const id = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { if (profile?.display_name) setName(profile.display_name); }, [profile?.display_name]);

  // Restore creds from localStorage (browser-only, never sent to our DB)
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TL_CREDS_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as { email?: string; server?: string; accountType?: "demo" | "live"; accountId?: string };
      if (c.email) setTlEmail(c.email);
      if (c.server) setTlServer(c.server);
      if (c.accountType) setTlAccountType(c.accountType);
      if (c.accountId) setTlAccountId(c.accountId);
    } catch { /* ignore */ }
  }, []);

  async function saveName() {
    if (!profile) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) { toast.error("Name must be at least 2 characters"); return; }
    setSavingName(true);
    const { error } = await supabase.from("profiles").update({ display_name: trimmed }).eq("id", profile.id);
    setSavingName(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Name updated");
    refresh();
  }

  async function testTradeLocker() {
    if (!tlEmail || !tlPassword || !tlServer) { toast.error("Email, password, and Server ID are required"); return; }
    setTlBusy("test");
    try {
      const res = await fetch("/api/tradelocker/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: tlEmail, password: tlPassword, server: tlServer, accountType: tlAccountType, test: true }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false || data?.error) { toast.error(data?.error || "Connection failed"); setTlConnected(false); return; }
      const accounts: TLAccount[] = data.accounts || [];
      setTlAccounts(accounts);
      if (accounts.length && !tlAccountId) setTlAccountId(String(accounts[0].id));
      setTlConnected(true);
      // Persist broker connection status so admins can see live/demo usage.
      try {
        await recordBroker({ data: { brokerName: "TradeLocker", accountType: tlAccountType, connected: true } });
      } catch (err) {
        console.error("Failed to record broker connection", err);
      }
      // Save non-secret prefs locally (NEVER the password)
      try {
        window.localStorage.setItem(TL_CREDS_KEY, JSON.stringify({ email: tlEmail, server: tlServer, accountType: tlAccountType, accountId: tlAccountId || (accounts[0] && String(accounts[0].id)) }));
      } catch { /* ignore */ }
      toast.success(`Connected · ${accounts.length} account${accounts.length === 1 ? "" : "s"} found`);

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection failed");
      setTlConnected(false);
    } finally {
      setTlBusy("");
    }
  }

  async function importTradeLocker() {
    if (!tlEmail || !tlPassword || !tlServer) { toast.error("Email, password, and Server ID are required"); return; }
    setTlBusy("import");
    try {
      const res = await fetch("/api/tradelocker/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: tlEmail, password: tlPassword, server: tlServer, accountType: tlAccountType, accountId: tlAccountId || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false || data?.error) { toast.error(data?.error || "Import failed"); return; }
      const incoming: TLTrade[] = data.trades || [];
      if (!incoming.length) { toast.info("No trades found on this TradeLocker account yet"); return; }
      // Merge into local journal (dedupe by id)
      let existing: TLTrade[] = [];
      try {
        const raw = window.localStorage.getItem(JOURNAL_KEY);
        existing = raw ? (JSON.parse(raw) as TLTrade[]) : [];
      } catch { /* ignore */ }
      const ids = new Set(existing.map((t) => t.id));
      const merged = [...existing, ...incoming.filter((t) => !ids.has(t.id))];
      window.localStorage.setItem(JOURNAL_KEY, JSON.stringify(merged));
      toast.success(`Imported ${incoming.length} trade${incoming.length === 1 ? "" : "s"} into your journal`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setTlBusy("");
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const data = await runExport({ data: undefined });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trademind-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Your data has been downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await runDelete({ data: undefined });
      // Wipe local prefs/journal so a future signup on this browser starts clean.
      try {
        const keys = ["trademind.journal.trades.v1", "trademind.tradelocker.creds.v1", "trademind.welcome-back.muted"];
        for (const k of keys) window.localStorage.removeItem(k);
      } catch { /* ignore */ }
      await supabase.auth.signOut();
      toast.success("Your account has been deleted");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* PROFILE */}
      <SectionLabel>Profile</SectionLabel>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <UserIcon className="size-5 text-primary" />
          Your Name
        </h2>
        <p className="text-sm text-muted-foreground mb-4">This is what shows on your dashboard and in coaching messages.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last" maxLength={80} />
          <PrimaryButton onClick={saveName} disabled={savingName} className="shrink-0">
            <Save className="size-4" /> {savingName ? "Saving..." : "Save"}
          </PrimaryButton>
        </div>
        {profile?.email && (
          <p className="mt-3 text-xs text-muted-foreground">Signed in as {profile.email}</p>
        )}
      </Card>

      {/* DISPLAY */}
      <SectionLabel>Display</SectionLabel>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Monitor className="size-5 text-primary" />
          Time Format
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Used by the on-chart clock and session badges. Switch any time.
        </p>
        <div className="flex items-center gap-2 mb-3">
          {(["12h", "24h"] as const).map((f) => {
            const active = timeFormat === f;
            return (
              <button
                key={f}
                onClick={() => setTimeFormat(f)}
                className={`px-4 h-10 rounded-lg border text-sm font-medium transition ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border bg-background/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "12h" ? "12-hour (AM/PM)" : "24-hour (military)"}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          Preview: <span className="text-foreground">{formatTime(clockNow, timeFormat, { seconds: true })}</span>
          {" · "}
          {formatTime(clockNow, timeFormat, { utc: true })} UTC
        </p>
      </Card>

      <Card className="mt-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Monitor className="size-5 text-primary" />
          Timezone
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Chart times, the on-chart clock, and session badges all use this timezone. Pick the one that matches how you trade so candles line up with your day.
        </p>
        <div className="max-w-sm mb-3">
          <Select value={timezone} onChange={(e) => { setTimezone(e.target.value); emitFirstWeekEvent("timezone-set"); }}>
            {TIMEZONE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-muted-foreground font-mono">
          Current: <span className="text-foreground">{
            new Date().toLocaleString(undefined, {
              hour: "2-digit", minute: "2-digit", hour12: timeFormat === "12h",
              timeZoneName: "short",
              timeZone: resolvedTimezone,
            })
          }</span>
          {timezone === AUTO_TZ && (
            <> {" · "} detected <span className="text-foreground">{detectedTz}</span></>
          )}
        </p>
      </Card>

      <Card className="mt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
              {welcomeMuted ? <VolumeX className="size-5 text-primary" /> : <Volume2 className="size-5 text-primary" />}
              Welcome Voice
            </h2>
            <p className="text-sm text-muted-foreground">
              Your coach greets you out loud when you sign in. Mute it if you'd rather start in silence.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !welcomeMuted;
              setWelcomeBackMuted(next);
              setWelcomeMutedState(next);
              toast.success(next ? "Welcome voice muted" : "Welcome voice on");
            }}
            role="switch"
            aria-checked={!welcomeMuted}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
              welcomeMuted ? "bg-muted" : "bg-primary"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition ${
                welcomeMuted ? "translate-x-0.5" : "translate-x-[22px]"
              }`}
            />
          </button>
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Palette className="size-5 text-primary" />
          Chart Colors
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Customize how candles look on every chart. Pick a color or paste a hex code. Saved on this device.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { key: "up", label: "Bullish body" },
            { key: "down", label: "Bearish body" },
            { key: "wickUp", label: "Bullish wick" },
            { key: "wickDown", label: "Bearish wick" },
            { key: "borderUp", label: "Bullish border" },
            { key: "borderDown", label: "Bearish border" },
          ] as Array<{ key: keyof CandleColors; label: string }>).map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
              <label className="flex-1 text-sm text-foreground/80">{label}</label>
              <input
                type="color"
                value={candleColors[key]}
                onChange={(e) => updateCandleColors({ [key]: e.target.value } as Partial<CandleColors>)}
                className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0"
                aria-label={`${label} color picker`}
              />
              <input
                type="text"
                value={candleColors[key]}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (isHex(v)) updateCandleColors({ [key]: v } as Partial<CandleColors>);
                }}
                spellCheck={false}
                className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs uppercase text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label={`${label} hex code`}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={resetCandleColors}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium text-foreground/80"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </button>
          <span className="text-xs text-muted-foreground">Changes save instantly</span>
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Palette className="size-5 text-primary" />
          Chart Background
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Choose a background style for the setup view (native chart). Pick a preset or fine-tune each color. Saved on this device.
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(CHART_BG_PRESETS).map(([name, preset]) => {
            const active = chartBg.bg.toLowerCase() === preset.bg.toLowerCase();
            return (
              <button
                key={name}
                type="button"
                onClick={() => setChartBgPreset(name)}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background hover:bg-muted text-foreground/80"}`}
              >
                <span className="inline-block h-4 w-4 rounded border border-border" style={{ background: preset.bg }} />
                {name}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { key: "bg", label: "Background" },
            { key: "grid", label: "Grid lines" },
            { key: "text", label: "Axis text" },
            { key: "border", label: "Border" },
          ] as Array<{ key: keyof ChartBackground; label: string }>).map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
              <label className="flex-1 text-sm text-foreground/80">{label}</label>
              <input
                type="color"
                value={chartBg[key]}
                onChange={(e) => updateChartBg({ [key]: e.target.value } as Partial<ChartBackground>)}
                className="h-8 w-9 cursor-pointer rounded border border-border bg-transparent p-0"
                aria-label={`${label} color picker`}
              />
              <input
                type="text"
                value={chartBg[key]}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (isHex(v)) updateChartBg({ [key]: v } as Partial<ChartBackground>);
                }}
                spellCheck={false}
                className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs uppercase text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label={`${label} hex code`}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={resetChartBg}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium text-foreground/80"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </button>
          <span className="text-xs text-muted-foreground">Changes save instantly</span>
        </div>
      </Card>










      {/* INTEGRATIONS */}
      <SectionLabel>Integrations</SectionLabel>


      <Card>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Plug className="size-5 text-primary" />
            Connect Your Broker
          </h2>
          {tlConnected ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-primary/40 text-primary bg-primary/10">
              <ShieldCheck className="size-3.5" /> Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-destructive/40 text-destructive bg-destructive/10">
              <XCircle className="size-3.5" /> Not Connected
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          Log in with your TradeLocker credentials to pull your trade history straight into the TradeMind journal. Credentials are sent over HTTPS to fetch your trades and are not stored on our servers - only your email, server, and account choice persist locally in this browser.
        </p>

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 mb-6">
          <div className="flex items-center gap-2 text-sm font-medium text-primary mb-1.5">
            <ShieldCheck className="size-4" />
            TradeLocker Public API
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Uses <code>{tlAccountType === "live" ? "live" : "demo"}.tradelocker.com/backend-api</code>. Your password is used only for this request and is never written to our database.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <FieldLabel icon={<UserIcon className="size-3.5" />}>TradeLocker Email</FieldLabel>
            <Input type="email" placeholder="your@email.com" value={tlEmail} onChange={(e) => setTlEmail(e.target.value)} />
          </div>
          <div>
            <FieldLabel icon={<ShieldCheck className="size-3.5" />}>TradeLocker Password</FieldLabel>
            <div className="relative">
              <Input
                type={showPw ? "text" : "password"}
                placeholder="Enter your TradeLocker password"
                value={tlPassword}
                onChange={(e) => setTlPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <Eye className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Used once per sync. Not stored.</p>
          </div>
          <div>
            <FieldLabel icon={<Plug className="size-3.5" />}>Server ID</FieldLabel>
            <Input placeholder="OSP-DEMO" value={tlServer} onChange={(e) => setTlServer(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1.5">
              The server shown on the TradeLocker login screen (e.g. "OSP-DEMO" or "OSP-LIVE").
            </p>
          </div>
          <div>
            <FieldLabel>Account Type</FieldLabel>
            <Select value={tlAccountType} onChange={(e) => setTlAccountType(e.target.value as "demo" | "live")}>
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </Select>
          </div>
          {tlAccounts.length > 0 && (
            <div className="md:col-span-2">
              <FieldLabel>Account</FieldLabel>
              <Select value={tlAccountId} onChange={(e) => setTlAccountId(e.target.value)}>
                {tlAccounts.map((a) => (
                  <option key={String(a.id)} value={String(a.id)}>
                    {a.name || `Account ${a.accNum ?? a.id}`} {typeof a.balance === "number" ? `· ${a.balance.toFixed(2)} ${a.currency ?? ""}` : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-6">
          <GhostButton onClick={testTradeLocker} disabled={tlBusy !== ""}>
            <Plug className="size-4" /> {tlBusy === "test" ? "Testing…" : "Test Connection"}
          </GhostButton>
          <PrimaryButton onClick={importTradeLocker} disabled={tlBusy !== "" || !tlConnected}>
            <Save className="size-4" /> {tlBusy === "import" ? "Importing…" : "Import Trades"}
          </PrimaryButton>
        </div>
        {!tlConnected && (
          <p className="flex items-center gap-1.5 text-xs text-primary mt-3">
            <AlertCircle className="size-3.5" />
            Test the connection first to load your accounts.
          </p>
        )}
      </Card>

      {/* STRATEGY moved to its own tab - see /scan-lens */}

      {/* TESTING MODE + BRIEFINGS */}
      <SectionLabel>Testing &amp; Briefings</SectionLabel>
      <Card>
        <h2 className="text-lg font-semibold mb-2">Testing mode (paper trading)</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Give TradeMind a $10,000 paper account and let the AI trade its A/A+ setups against live prices.
          Your equity, positions, and closed trades live on the Testing page. A 10% drawdown from peak
          closes every position and pauses new trades until you review.
        </p>
        <a href="/testing" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90">
          Open Testing dashboard
        </a>
      </Card>
      <Card className="mt-4">
        <h2 className="text-lg font-semibold mb-2">Daily briefings</h2>
        <p className="text-sm text-muted-foreground mb-4">
          A morning briefing before the session and an evening report after the close, delivered in-app,
          to Telegram, and to Discord. Configure hours, timezone, watchlist, Telegram, and Discord webhooks
          from the Briefings page.
        </p>
        <a href="/briefings" className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90">
          Open Briefings
        </a>
      </Card>


      <SectionLabel>Privacy &amp; Data</SectionLabel>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Download className="size-5 text-primary" />
          Download all my data
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Exports your account, profile, chat history, AI usage, and connection data as a JSON file.
          Trade journal entries are stored locally in this browser and not included.
        </p>
        <GhostButton onClick={handleExport} disabled={exporting}>
          <Download className="size-4" />
          {exporting ? "Preparing…" : "Download my data (JSON)"}
        </GhostButton>
      </Card>

      <Card className="mt-4 border-destructive/40">
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Trash2 className="size-5 text-destructive" />
          Delete my account
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Permanently deletes your account and every piece of data attached to it - profile, chats, usage
          history, broker connections. <strong className="text-foreground">This cannot be undone.</strong>
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-destructive/10 border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/20 transition"
          >
            <Trash2 className="size-4" /> Delete my account
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Type <code className="px-1.5 py-0.5 rounded bg-background/60 border border-border font-mono">DELETE</code> to confirm.
            </p>
            <Input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || deleteText !== "DELETE"}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="size-4" />
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
              <GhostButton
                onClick={() => { setConfirmDelete(false); setDeleteText(""); }}
                disabled={deleting}
              >
                Cancel
              </GhostButton>
            </div>
          </div>
        )}
      </Card>

      {/* SECURITY - RECOVERY CODE */}
      <SectionLabel>Security</SectionLabel>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <KeyRound className="size-5 text-primary" />
          Account Recovery Code
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          A one-time code you can use to reset your password if you ever lose access to your email.
          Keep it somewhere safe - a password manager or your own inbox works well.
          {hasCode === true && !newCode && (
            <span className="block mt-2 text-foreground">You already have a recovery code set. Generating a new one will replace it.</span>
          )}
          {hasCode === false && !newCode && (
            <span className="block mt-2 text-primary">You don't have a recovery code yet. Generate one now.</span>
          )}
        </p>

        {newCode ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-5 text-center">
              <div className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground mb-2">Your recovery code</div>
              <div className="font-mono text-xl sm:text-2xl font-semibold tracking-wider text-foreground break-all">{newCode}</div>
            </div>
            <p className="text-xs text-muted-foreground">
              This is the only time we'll show this code. Save it before leaving this page.
            </p>
            <div className="flex flex-wrap gap-2">
              <GhostButton onClick={copyCode}><Copy className="size-4" /> Copy</GhostButton>
              <GhostButton onClick={emailCode} disabled={emailingCode || !profile?.email}>
                <Mail className="size-4" /> Email it to me
              </GhostButton>
              <PrimaryButton onClick={() => setNewCode(null)}>
                I've saved it
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <PrimaryButton onClick={generateAndSaveCode} disabled={savingCode}>
            <KeyRound className="size-4" />
            {savingCode ? "Generating…" : hasCode ? "Generate new code" : "Generate recovery code"}
          </PrimaryButton>
        )}
      </Card>

      {/* BILLING */}
      <SectionLabel>Billing</SectionLabel>
      <BillingCard />


    </div>
  );
}

function BillingCard() {
  const navigate = useNavigate();
  const openPortal = useServerFn(createPortalSession);
  const getSub = useServerFn(getMySubscription);
  const [sub, setSub] = useState<{
    tier: string | null;
    status: string;
    current_period_end: string | null;
    trial_end: string | null;
    cancel_at_period_end: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSub().then((s) => {
      if (!cancelled) setSub(s as typeof sub);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [getSub]);

  const active = sub && (sub.status === "active" || sub.status === "trialing");

  async function manage() {
    setLoading(true);
    try {
      const { url } = await openPortal();
      if (url) window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open billing portal");
      setLoading(false);
    }
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
        <CreditCard className="size-5 text-primary" />
        Subscription
      </h2>
      <div className="text-sm text-muted-foreground mb-2">Status</div>
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md mb-5 ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground"
      }`}>
        <ShieldCheck className="size-3.5" />
        {sub ? (
          <>
            {sub.status}
            {sub.tier ? ` · ${sub.tier}` : ""}
            {sub.cancel_at_period_end ? " (cancelling)" : ""}
          </>
        ) : "No subscription"}
      </span>
      {sub?.current_period_end && (
        <div className="text-xs text-muted-foreground mb-4">
          {sub.status === "trialing" ? "Trial ends" : "Renews"} on{" "}
          {new Date(sub.current_period_end).toLocaleDateString()}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {active ? (
          <GhostButton onClick={manage} disabled={loading}>
            <ExternalLink className="size-4" />
            {loading ? "Opening…" : "Manage subscription"}
          </GhostButton>
        ) : (
          <GhostButton onClick={() => navigate({ to: "/pricing" })}>
            <CreditCard className="size-4" /> Choose a plan
          </GhostButton>
        )}
      </div>
    </Card>
  );
}

