import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, Trash2, ShieldCheck, LogIn, X } from "lucide-react";
import {
  startAlpacaLogin,
  getAlpacaStatus,
  getAlpacaPositions,
  closeAlpacaPosition,
  disconnectAlpaca,
} from "@/lib/broker-alpaca.functions";

type Status = Awaited<ReturnType<typeof getAlpacaStatus>>;
type Positions = Awaited<ReturnType<typeof getAlpacaPositions>>;

function money(v: number | null, ccy = "USD") {
  if (v == null) return "—";
  return `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;
}

// Alpaca is the one broker here with real OAuth: the trader signs in on Alpaca's
// own site and we only ever hold a scoped token, never their password.
export function AlpacaPanel() {
  const start = useServerFn(startAlpacaLogin);
  const fetchStatus = useServerFn(getAlpacaStatus);
  const fetchPositions = useServerFn(getAlpacaPositions);
  const close = useServerFn(closeAlpacaPosition);
  const logout = useServerFn(disconnectAlpaca);

  const [status, setStatus] = useState<Status | null>(null);
  const [positions, setPositions] = useState<Positions>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const s = await fetchStatus();
      setStatus(s);
      if (s.connected) {
        try {
          setPositions(await fetchPositions());
        } catch {
          setPositions([]);
        }
      } else {
        setPositions([]);
      }
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

  async function signIn() {
    setConnecting(true);
    try {
      const { url } = await start({ data: { origin: window.location.origin } });
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
      setConnecting(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Alpaca</div>
          <div className="font-semibold text-sm">Sign in with Alpaca (one click)</div>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs hover:bg-muted"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {status?.connected ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Account" value={status.accountNumber ?? status.accountId.slice(0, 8)} />
            <Stat label="Mode" value={status.env === "live" ? "Live" : "Paper"} />
            <Stat label="Equity" value={money(status.equity, status.currency)} />
            <Stat label="Buying power" value={money(status.buyingPower, status.currency)} />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <ShieldCheck className="h-3.5 w-3.5" />
            Signed in through Alpaca. Status: {status.status ?? "unknown"}
            {status.tradingBlocked ? " — trading is blocked on this account" : ""}
          </div>

          {positions.length > 0 && (
            <div className="border border-border rounded-md divide-y divide-border mb-4">
              {positions.map((p) => (
                <div key={p.symbol} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{p.symbol}</span>
                    <span className="text-xs uppercase text-muted-foreground">
                      {p.side} {p.qty}
                    </span>
                    <span className="text-xs text-muted-foreground">@ {p.avgPrice}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={p.unrealizedPl >= 0 ? "text-emerald-500" : "text-red-500"}>
                      {p.unrealizedPl >= 0 ? "+" : ""}
                      {p.unrealizedPl.toFixed(2)}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await close({ data: { symbol: p.symbol } });
                          toast.success(`Closing ${p.symbol}`);
                          void refresh();
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-xs hover:bg-muted"
                    >
                      <X className="h-3 w-3" />
                      Close
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={async () => {
              try {
                await logout({});
                toast.success("Alpaca disconnected");
                void refresh();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-muted"
          >
            <Trash2 className="h-4 w-4" />
            Disconnect Alpaca
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            No API keys to copy. Click below, log in on Alpaca's own page, approve access, and you land
            back here connected. Works with both paper and live accounts.
          </p>
          <button
            onClick={() => void signIn()}
            disabled={connecting}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-foreground text-background text-sm font-medium disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {connecting ? "Opening Alpaca..." : "Sign in with Alpaca"}
          </button>
          {status && !status.connected && (
            <p className="text-xs text-muted-foreground mt-3">{status.reason}</p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
