import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { LogIn, RefreshCw, ExternalLink, Trash2, ShieldCheck } from "lucide-react";
import {
  connectTradeLocker,
  getTradeLockerStatus,
  setTradeLockerAccount,
  disconnectTradeLocker,
} from "@/lib/broker-tradelocker.functions";

type Status = Awaited<ReturnType<typeof getTradeLockerStatus>>;

function money(v: number | null, ccy: string | null) {
  if (v == null) return "—";
  return `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy ?? ""}`.trim();
}

// TradeLocker exposes a real credential login on its public API, so this panel
// signs the trader in with their own TradeLocker email, password and server.
export function TradeLockerPanel() {
  const login = useServerFn(connectTradeLocker);
  const fetchStatus = useServerFn(getTradeLockerStatus);
  const pickAccount = useServerFn(setTradeLockerAccount);
  const logout = useServerFn(disconnectTradeLocker);

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [env, setEnv] = useState<"demo" | "live">("demo");

  async function refresh() {
    setLoading(true);
    try {
      setStatus(await fetchStatus());
    } catch (e) {
      setStatus({ connected: false, reason: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!email || !password || !server) {
      toast.error("Email, password and server are all required");
      return;
    }
    setSigningIn(true);
    try {
      const res = await login({ data: { email, password, server, env } });
      toast.success(`Logged in to TradeLocker ${env} — ${res.accounts.length} account(s)`);
      setPassword("");
      setShowForm(false);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSigningIn(false);
    }
  }

  async function choose(id: string) {
    try {
      await pickAccount({ data: { accountId: id } });
      await refresh();
      toast.success("Trading account switched");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function signOut() {
    try {
      await logout({ data: {} });
      setStatus({ connected: false, reason: "No TradeLocker login saved yet." });
      toast.success("Logged out of TradeLocker");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-5 mb-6">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
        <LogIn className="h-3.5 w-3.5" /> TradeLocker login
        <button
          onClick={refresh}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] font-semibold normal-case tracking-normal hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {status?.connected ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Signed in as <span className="font-semibold">{status.email}</span> on server{" "}
            <span className="font-mono">{status.server}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">
              {status.env === "live" ? "Live" : "Demo"}
            </span>
          </div>

          <div className="space-y-2">
            {status.accounts.map((a) => {
              const active = a.id === status.activeAccountId;
              return (
                <button
                  key={a.id}
                  onClick={() => (active ? undefined : choose(a.id))}
                  className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-3 py-2 text-left text-sm ${
                    active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                  }`}
                >
                  <span className="font-mono">{a.accNum ?? a.id}</span>
                  {a.name && <span className="text-muted-foreground">{a.name}</span>}
                  <span className="text-muted-foreground">{money(a.balance, a.currency)}</span>
                  {a.status && <span className="text-xs text-muted-foreground">{a.status}</span>}
                  {active && (
                    <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                      IN USE
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              <LogIn className="h-3 w-3" /> Log in to another account
            </button>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              <Trash2 className="h-3 w-3" /> Log out
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {status?.reason ?? "Checking your TradeLocker session..."}
          </p>
          <p className="text-xs text-muted-foreground">
            TradeLocker signs you in with the same email, password and server name you use in the TradeLocker
            terminal, so no API token is needed. Your login is encrypted before it is stored.
          </p>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <LogIn className="h-3 w-3" /> Log in with TradeLocker
            </button>
          )}
        </div>
      )}

      {showForm && (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder="you@example.com"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder="TradeLocker password"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Server
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              placeholder="e.g. OSP-DEMO"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Environment
            <select
              value={env}
              onChange={(e) => setEnv(e.target.value as "demo" | "live")}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="demo">Demo</option>
              <option value="live">Live</option>
            </select>
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <button
              onClick={submit}
              disabled={signingIn}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {signingIn ? <RefreshCw className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
              {signingIn ? "Signing in..." : "Sign in"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
            >
              Cancel
            </button>
            <a
              href="https://tradelocker.com/"
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" /> Find your server name
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
