import { PageInstructions } from "@/components/PageInstructions";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useTimeFormat, formatTime } from "@/hooks/useTimeFormat";
import { useTimezone, TIMEZONE_OPTIONS, AUTO_TZ } from "@/hooks/useTimezone";
import { exportMyData, deleteMyAccount } from "@/lib/privacy.functions";
import { cancelMySubscription, createPortalSession, getMySubscription } from "@/lib/billing.functions";
import { toast } from "sonner";

import {
  ShieldCheck,
  User as UserIcon,
  CreditCard,
  ExternalLink,
  Monitor,
  Save,
  Volume2,
  VolumeX,
  Download,
  Trash2,
  Palette,
  RotateCcw,
  Mail,

} from "lucide-react";
import { isWelcomeBackMuted, setWelcomeBackMuted } from "@/lib/welcomeBack";
import { useCandleColors, type CandleColors } from "@/hooks/useCandleColors";
import { useChartBackground, CHART_BG_PRESETS, type ChartBackground } from "@/hooks/useChartBackground";
import { ChartReadabilityNotice } from "@/components/ChartReadabilityNotice";
import { contrastRatio, formatRatio } from "@/lib/chartContrast";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings, TradeMind" }] }),
  component: SettingsPage,
});

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 my-8">
      <span className="text-[11px] font-medium tracking-[0.2em] text-muted-foreground">
        {children}
      </span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border/60 bg-card/40 p-6 ${className}`}>
      {children}
    </div>
  );
}

/** Legacy username accounts got a placeholder address; those users must add a real one. */
const PLACEHOLDER_EMAIL_DOMAIN = "@trademindaicoach.com";

function EmailCard({ currentEmail }: { currentEmail: string | null }) {
  const needsRealEmail = !currentEmail || currentEmail.toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function save() {
    const email = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (email.endsWith(PLACEHOLDER_EMAIL_DOMAIN)) {
      toast.error("Use your own email address");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw new Error(error.message);
      setSent(true);
      toast.success("Confirmation link sent. Check that inbox to finish.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={needsRealEmail ? "border-primary/50" : ""}>
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
        <Mail className="size-5 text-primary" />
        Email address
      </h2>
      {needsRealEmail ? (
        <p className="text-sm text-muted-foreground mb-4">
          Your account was created with a username. Add your real email so you can reset your
          password and receive account notices. We send a confirmation link before the change takes effect.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground mb-4">
          Sign-in email: <span className="text-foreground">{currentEmail}</span>. Changing it sends a
          confirmation link to the new address.
        </p>
      )}
      {sent ? (
        <p className="text-sm text-primary">Confirmation link sent. Click it to finish the change.</p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="you@email.com"
            type="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={255}
          />
          <PrimaryButton onClick={save} disabled={busy} className="shrink-0">
            <Save className="size-4" /> {busy ? "Sending..." : needsRealEmail ? "Add email" : "Change email"}
          </PrimaryButton>
        </div>
      )}
    </Card>
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
      className={`w-full h-11 rounded-2xl bg-background/60 border border-border/60 px-3.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 ${props.className ?? ""}`}
    />
  );
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full h-11 rounded-2xl bg-background/60 border border-border/60 px-3.5 text-sm focus:outline-none focus:border-primary/50 appearance-none bg-no-repeat bg-[right_0.75rem_center] ${props.className ?? ""}`}
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
      className={`inline-flex items-center gap-2 h-10 px-4 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 h-10 px-4 rounded-2xl bg-background/60 border border-border/60 text-sm font-medium hover:border-primary/40 transition ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function SettingsPage() {
  const navigate = useNavigate();
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

  // Privacy / GDPR
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const runExport = useServerFn(exportMyData);
  const runDelete = useServerFn(deleteMyAccount);

  useEffect(() => {

    const id = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => { if (profile?.display_name) setName(profile.display_name); }, [profile?.display_name]);

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
      <PageInstructions className="mb-4" />
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

      <div className="mt-4">
        <EmailCard currentEmail={profile?.email ?? null} />
      </div>



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
                className={`px-4 h-10 rounded-2xl border text-sm font-medium transition ${
                  active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 bg-background/40 text-muted-foreground hover:text-foreground"
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
            <div key={key} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
              <label className="flex-1 text-sm text-foreground/80">{label}</label>
              <input
                type="color"
                value={candleColors[key]}
                onChange={(e) => updateCandleColors({ [key]: e.target.value } as Partial<CandleColors>)}
                className="h-8 w-9 cursor-pointer rounded border border-border/60 bg-transparent p-0"
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
                className="w-24 rounded border border-border/60 bg-background px-2 py-1 font-mono text-xs text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label={`${label} hex code`}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={resetCandleColors}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium text-foreground/80"
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
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-background hover:bg-muted text-foreground/80"}`}
              >
                <span className="inline-block h-4 w-4 rounded border border-border/60" style={{ background: preset.bg }} />
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
            <div key={key} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
              <label className="flex-1 text-sm text-foreground/80">{label}</label>
              <input
                type="color"
                value={chartBg[key]}
                onChange={(e) => updateChartBg({ [key]: e.target.value } as Partial<ChartBackground>)}
                className="h-8 w-9 cursor-pointer rounded border border-border/60 bg-transparent p-0"
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
                className="w-24 rounded border border-border/60 bg-background px-2 py-1 font-mono text-xs text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label={`${label} hex code`}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 text-xs text-muted-foreground">
          Label contrast {formatRatio(contrastRatio(chartBg.text, chartBg.bg))} (4.5:1 or better reads cleanly)
        </div>
        <ChartReadabilityNotice className="mt-2" />
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={resetChartBg}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-background hover:bg-muted px-3 py-1.5 text-xs font-medium text-foreground/80"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </button>
          <span className="text-xs text-muted-foreground">Changes save instantly</span>
        </div>
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
            className="inline-flex items-center gap-2 h-10 px-4 rounded-2xl bg-destructive/10 border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/20 transition"
          >
            <Trash2 className="size-4" /> Delete my account
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Type <code className="px-1.5 py-0.5 rounded bg-background/60 border border-border/60 font-mono">DELETE</code> to confirm.
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
                className="inline-flex items-center gap-2 h-10 px-4 rounded-2xl bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
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
  const [cancelling, setCancelling] = useState(false);
  const changeCancel = useServerFn(cancelMySubscription);

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

  async function toggleCancel(resume: boolean) {
    if (!resume && !window.confirm("Cancel your membership? You keep access until the end of the paid period.")) return;
    setCancelling(true);
    try {
      const res = await changeCancel({ data: { resume } });
      setSub((prev) => (prev ? { ...prev, ...res } : prev));
      toast.success(resume ? "Membership resumed" : "Membership cancels at period end");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update membership");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
        <CreditCard className="size-5 text-primary" />
        Subscription
      </h2>
      <div className="text-sm text-muted-foreground mb-2">Status</div>
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-xl mb-5 ${
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

