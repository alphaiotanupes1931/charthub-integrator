import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useTimeFormat, formatTime } from "@/hooks/useTimeFormat";
import { toast } from "sonner";
import {
  Plug,
  ShieldCheck,
  User as UserIcon,
  Eye,
  Crosshair,
  ArrowDown,
  ArrowUp,
  TrendingUp,
  ArrowLeftRight,
  Hash,
  CreditCard,
  ExternalLink,
  Monitor,
  Save,
  XCircle,
  AlertCircle,
} from "lucide-react";

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
  const [showPw, setShowPw] = useState(false);
  const { profile, refresh } = useProfile();
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const { format: timeFormat, setFormat: setTimeFormat } = useTimeFormat();
  const [clockNow, setClockNow] = useState(() => new Date());

  // TradeLocker integration state
  const [tlEmail, setTlEmail] = useState("");
  const [tlPassword, setTlPassword] = useState("");
  const [tlServer, setTlServer] = useState("OSP-DEMO");
  const [tlAccountType, setTlAccountType] = useState<"demo" | "live">("demo");
  const [tlBusy, setTlBusy] = useState<"" | "test" | "import">("");
  const [tlAccounts, setTlAccounts] = useState<TLAccount[]>([]);
  const [tlAccountId, setTlAccountId] = useState<string>("");
  const [tlConnected, setTlConnected] = useState(false);

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
      if (!res.ok) { toast.error(data.error || "Connection failed"); setTlConnected(false); return; }
      const accounts: TLAccount[] = data.accounts || [];
      setTlAccounts(accounts);
      if (accounts.length && !tlAccountId) setTlAccountId(String(accounts[0].id));
      setTlConnected(true);
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
      if (!res.ok) { toast.error(data.error || "Import failed"); return; }
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

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
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



      {/* INTEGRATIONS */}
      <SectionLabel>Integrations</SectionLabel>


      <Card>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Plug className="size-5 text-primary" />
            Connect Your Broker
          </h2>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-destructive/40 text-destructive bg-destructive/10">
            <XCircle className="size-3.5" />
            Not Connected
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          Enter your broker's API credentials to enable automatic trade import, real-time monitoring, and live position tracking.
        </p>

        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 mb-6">
          <div className="flex items-center gap-2 text-sm font-medium text-primary mb-1.5">
            <ShieldCheck className="size-4" />
            Enter your TradeLocker login credentials
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Uses TradeLocker's Public API (public-api.tradelocker.com). Your email, password, and Server ID are encrypted with AES-256 before storage.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <FieldLabel>Select Your Broker</FieldLabel>
            <Select defaultValue="">
              <option value="" disabled>Choose a broker...</option>
              <option>OANDA</option>
              <option>FTMO</option>
              <option>The Funded Trader</option>
            </Select>
          </div>
          <div>
            <FieldLabel>Platform</FieldLabel>
            <Select defaultValue="TradeLocker">
              <option>TradeLocker</option>
              <option>MT4</option>
              <option>MT5</option>
            </Select>
          </div>
          <div>
            <FieldLabel icon={<UserIcon className="size-3.5" />}>TradeLocker Email</FieldLabel>
            <Input type="email" placeholder="your@email.com" />
            <p className="text-xs text-muted-foreground mt-1.5">Your TradeLocker account email</p>
          </div>
          <div>
            <FieldLabel icon={<ShieldCheck className="size-3.5" />}>TradeLocker Password</FieldLabel>
            <div className="relative">
              <Input type={showPw ? "text" : "password"} placeholder="Enter your TradeLocker password" />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <Eye className="size-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Encrypted with AES-256 before storage</p>
          </div>
          <div>
            <FieldLabel icon={<Plug className="size-3.5" />}>Server ID</FieldLabel>
            <Select defaultValue="OSP-DEMO">
              <option>OSP-DEMO</option>
              <option>OSP-LIVE</option>
            </Select>
            <p className="text-xs text-muted-foreground mt-1.5">
              The server name shown on the TradeLocker login screen (e.g., "OSP-DEMO" or "OSP-LIVE")
            </p>
          </div>
          <div>
            <FieldLabel>
              API Endpoint URL <span className="text-muted-foreground font-normal">(optional)</span>
            </FieldLabel>
            <Input placeholder="https://public-api.tradelocker.com" />
            <p className="text-xs text-muted-foreground mt-1.5">Default: public-api.tradelocker.com, only change if needed</p>
          </div>
        </div>

        <div className="mt-5">
          <FieldLabel>Account Type</FieldLabel>
          <Select defaultValue="Live">
            <option>Live</option>
            <option>Demo</option>
          </Select>
          <p className="text-xs text-muted-foreground mt-1.5">Demo and live accounts use different API endpoints</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-6">
          <GhostButton><Plug className="size-4" /> Test Connection</GhostButton>
          <PrimaryButton><Save className="size-4" /> Save Credentials</PrimaryButton>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> AES-256 encrypted
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-primary mt-3">
          <AlertCircle className="size-3.5" />
          You must test your connection before saving
        </p>
      </Card>

      {/* STRATEGY moved to its own tab — see /scan-lens */}

      {/* BILLING */}
      <SectionLabel>Billing</SectionLabel>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-4">
          <CreditCard className="size-5 text-primary" />
          Subscription
        </h2>
        <div className="text-sm text-muted-foreground mb-2">Status</div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md bg-primary text-primary-foreground mb-5">
          <ShieldCheck className="size-3.5" />
          Active
        </span>
        <div>
          <GhostButton><ExternalLink className="size-4" /> Manage Subscription</GhostButton>
        </div>
      </Card>

    </div>
  );
}
