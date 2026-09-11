import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, Trash2, RefreshCw, LogIn, ExternalLink } from "lucide-react";
import {
  connectTradeLocker,
  getTradeLockerStatus,
  setTradeLockerAccount,
  disconnectTradeLocker,
} from "@/lib/broker-tradelocker.functions";

type Status = Awaited<ReturnType<typeof getTradeLockerStatus>>;

/**
 * TradeLocker sign-in: the trader logs in with the email, password and server
 * they use on TradeLocker. The session is stored encrypted server-side.
 */
export function TradeLockerConnectPanel({ onChange }: { onChange?: () => void }) {
  const getStatus = useServerFn(getTradeLockerStatus);
  const connect = useServerFn(connectTradeLocker);
  const setAccount = useServerFn(setTradeLockerAccount);
  const disconnect = useServerFn(disconnectTradeLocker);

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const s = await getStatus();
      setStatus(s);
      setShowForm(!s.connected);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setBusy(true);
    try {
      const res = await connect({
        data: { email: email.trim(), password, server: server.trim(), env: "live" },
      });
      toast.success(`Signed in to TradeLocker (${res.server})`);
      setEmail("");
      setPassword("");
      setServer("");
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUseAccount(accountId: string) {
    setBusy(true);
    try {
      await setAccount({ data: { accountId } });
      toast.success("Trading now routes to that account");
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await disconnect();
      toast.success("TradeLocker signed out");
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connected === true ? status : null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">TradeLocker</div>
        {loading ? (
          <RefreshCw className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <span
            className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${
              connected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {connected ? "Signed in" : "Not signed in"}
          </span>
        )}
      </div>

      {connected && (
        <div className="space-y-2 mb-4">
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{connected.email}</span> on{" "}
            <span className="font-medium text-foreground">{connected.server}</span>
          </p>
          {connected.accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs">
              <span className="font-semibold">Account {a.accNum ?? a.id}</span>
              {a.name && <span className="text-muted-foreground truncate">{a.name}</span>}
              {a.balance != null && (
                <span className="font-mono text-muted-foreground">
                  {a.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {a.currency ?? ""}
                </span>
              )}
              <div className="flex-1" />
              {a.id === connected.activeAccountId ? (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">Active</span>
              ) : (
                <button
                  onClick={() => handleUseAccount(a.id)}
                  disabled={busy}
                  className="rounded-lg border border-border/60 px-2 py-1 font-semibold hover:bg-muted disabled:opacity-50"
                >
                  Use this
                </button>
              )}
            </div>
          ))}
          <div>
            <button
              onClick={handleDisconnect}
              disabled={busy}
              className="mt-1 inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Sign out of TradeLocker
            </button>
          </div>
        </div>
      )}

      {!connected && status && !status.connected && !loading && status.reason && !showForm && (
        <p className="text-xs text-muted-foreground mb-3">{status.reason}</p>
      )}

      {connected && !showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-muted"
        >
          Use a different login
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Log in with the email, password and server you use on TradeLocker. Your login stays
            encrypted on the server and is never shown in the browser.
          </p>
          <input
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            type="email"
            autoComplete="username"
            placeholder="TradeLocker email"
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
          />
          <input
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            type="password"
            autoComplete="current-password"
            placeholder="TradeLocker password"
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
          />
          <input
            value={server}
            onChange={(ev) => setServer(ev.target.value)}
            type="text"
            autoComplete="off"
            placeholder="Server (shown on your TradeLocker login, e.g. your broker's server name)"
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleConnect}
              disabled={busy || !email.trim() || !password || !server.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" /> {busy ? "Signing in..." : "Sign in to TradeLocker"}
            </button>
            <a
              href="https://tradelocker.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open TradeLocker <ExternalLink className="h-3 w-3" />
            </a>
            {connected && (
              <button onClick={() => setShowForm(false)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
