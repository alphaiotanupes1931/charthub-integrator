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
  Zap,
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

const LENSES = [
  { id: "wyckoff", icon: Crosshair, name: "Wyckoff Core", desc: "Pure institutional phase detection. No overlay." },
  { id: "accum", icon: ArrowDown, name: "Accumulation Specialist", desc: "Highlights Spring + BOS in uptrends. Demand absorption focus." },
  { id: "dist", icon: ArrowUp, name: "Distribution Specialist", desc: "Highlights Upthrust + BOS in downtrends. Supply absorption focus." },
  { id: "trend", icon: TrendingUp, name: "Trend Trader", desc: "Breakout + retest in established trends. Momentum aligned." },
  { id: "range", icon: ArrowLeftRight, name: "Range Trader", desc: "Wick extremes within consolidation ranges. Mean reversion." },
  { id: "fib", icon: Hash, name: "Fibonacci Confluence", desc: "Adds Fib retracement and extension targets. Wyckoff still core." },
];

function SettingsPage() {
  const [showPw, setShowPw] = useState(false);
  const [activeLens, setActiveLens] = useState("wyckoff");
  const { profile, refresh } = useProfile();
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

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

      {/* STRATEGY */}
      <SectionLabel>Strategy</SectionLabel>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Crosshair className="size-5 text-primary" />
          Strategy Lens
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Wyckoff Sweep → BOS → Retest runs on every scan. Choose a lens to adjust emphasis and presentation.
        </p>
        <div className="space-y-2.5">
          {LENSES.map((l) => {
            const active = activeLens === l.id;
            const Icon = l.icon;
            return (
              <button
                key={l.id}
                onClick={() => setActiveLens(l.id)}
                className={`w-full text-left rounded-lg border p-4 transition flex items-start gap-3 ${
                  active
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-background/40 hover:border-border/80"
                }`}
              >
                <Icon className={`size-5 mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-medium ${active ? "text-primary" : ""}`}>{l.name}</span>
                    {active && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-primary/40 text-primary">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{l.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
        <p className="italic text-xs text-muted-foreground mt-5">
          Strategy is the lens, not the law. No lens overrides Wyckoff grading, Sweep → BOS → Retest is always required for A+ entries.
        </p>
      </Card>

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

      {/* DEFAULTS */}
      <SectionLabel>Defaults</SectionLabel>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold mb-2">
          <Zap className="size-5 text-primary" />
          Trade Execution
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Configure your default lot size for one-tap trade execution from signal analysis.
        </p>
        <FieldLabel>Default Lot Size</FieldLabel>
        <Input defaultValue="0.01" />
        <p className="text-xs text-muted-foreground mt-1.5 mb-4">
          This lot size will pre-fill when you click "Execute Trade" on a signal.
        </p>
        <PrimaryButton><Save className="size-4" /> Save Lot Size</PrimaryButton>

        <div className="h-px bg-border/60 my-6" />

        <h3 className="flex items-center gap-2 text-base font-semibold mb-2">
          <Monitor className="size-4 text-primary" />
          Trading Platform
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Which platform do you chart and trade on? The AI will tailor its analysis to match your platform.
        </p>
        <Select defaultValue="TradingView">
          <option>TradingView</option>
          <option>MT4</option>
          <option>MT5</option>
          <option>TradeLocker</option>
        </Select>
        <div className="mt-4">
          <PrimaryButton><Save className="size-4" /> Save Platform</PrimaryButton>
        </div>

        <div className="h-px bg-border/60 my-6" />

        <h3 className="flex items-center gap-2 text-base font-semibold mb-2">
          <Crosshair className="size-4 text-primary" />
          Preferred Broker
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Signal disclaimers will adjust based on your broker's pricing differences from OANDA.
        </p>
        <Select defaultValue="OANDA (Default)">
          <option>OANDA (Default)</option>
          <option>FTMO</option>
          <option>The Funded Trader</option>
        </Select>
        <div className="mt-4">
          <PrimaryButton><Save className="size-4" /> Save Broker</PrimaryButton>
        </div>

        <div className="h-px bg-border/60 my-6" />

        <h3 className="text-base font-semibold mb-2">Trading Style</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Drives the adaptive timeframe hierarchy and per-style risk multipliers. The chart TF auto-aligns when you change style.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Select defaultValue="Intraday, hours">
            <option>Scalp, minutes</option>
            <option>Intraday, hours</option>
            <option>Swing, days</option>
            <option>Position, weeks</option>
          </Select>
          <Select defaultValue="">
            <option value="" disabled>Risk profile…</option>
            <option>Conservative</option>
            <option>Balanced</option>
            <option>Aggressive</option>
          </Select>
        </div>
      </Card>
    </div>
  );
}
