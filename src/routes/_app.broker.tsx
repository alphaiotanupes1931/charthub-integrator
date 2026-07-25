import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wallet, RefreshCw, X, ExternalLink } from "lucide-react";
import {
  getBrokerStatus,
  listBrokerPositions,
  closeBrokerTrade,
  placeBrokerOrder,
} from "@/lib/broker-oanda.functions";

type BrokerSearch = {
  symbol?: string;
  side?: "long" | "short";
  entry?: number | string;
  stop?: number | string;
  tp?: number | string;
};

export const Route = createFileRoute("/_app/broker")({
  validateSearch: (s: Record<string, unknown>): BrokerSearch => ({
    symbol: typeof s.symbol === "string" ? s.symbol : undefined,
    side: s.side === "long" || s.side === "short" ? s.side : undefined,
    entry: s.entry != null && s.entry !== "" ? Number(s.entry) : undefined,
    stop: s.stop != null && s.stop !== "" ? Number(s.stop) : undefined,
    tp: s.tp != null && s.tp !== "" ? Number(s.tp) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Broker (OANDA) — TradeMind" },
      { name: "description", content: "Connect your OANDA account and place real trades from your scans." },
      { property: "og:title", content: "Broker (OANDA) — TradeMind" },
      { property: "og:description", content: "Place real trades on OANDA directly from TradeMind scans." },
    ],
  }),
  component: BrokerPage,
});

type Status = Awaited<ReturnType<typeof getBrokerStatus>>;
type Position = Awaited<ReturnType<typeof listBrokerPositions>>[number];

function BrokerPage() {
  const fetchStatus = useServerFn(getBrokerStatus);
  const fetchPositions = useServerFn(listBrokerPositions);
  const closeTrade = useServerFn(closeBrokerTrade);
  const placeOrder = useServerFn(placeBrokerOrder);

  const [status, setStatus] = useState<Status | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);

  // Manual order form
  const [symbol, setSymbol] = useState("EUR/USD");
  const [side, setSide] = useState<"long" | "short">("long");
  const [units, setUnits] = useState(1000);
  const [stopLoss, setStopLoss] = useState<string>("");
  const [takeProfit, setTakeProfit] = useState<string>("");

  async function refresh() {
    setLoading(true);
    try {
      const s = await fetchStatus();
      setStatus(s);
      if (s.connected) {
        const p = await fetchPositions().catch(() => []);
        setPositions(p);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function submitOrder() {
    setPlacing(true);
    try {
      const res = await placeOrder({
        data: {
          symbol,
          side,
          units,
          orderType: "market",
          stopLoss: stopLoss ? Number(stopLoss) : undefined,
          takeProfit: takeProfit ? Number(takeProfit) : undefined,
        },
      });
      toast.success(`Order filled${res.fillPrice ? ` at ${res.fillPrice}` : ""}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlacing(false);
    }
  }

  async function handleClose(id: string) {
    if (!confirm("Close this trade at market?")) return;
    try {
      await closeTrade({ data: { tradeId: id } });
      toast.success("Trade closed");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold mb-2">Broker: OANDA</h1>
          <p className="text-sm text-muted-foreground">
            Place real orders on your connected OANDA account. Signals from the dashboard can prefill this form.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {status && !status.connected && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-5 mb-6">
          <div className="font-semibold text-sm mb-1">Not connected</div>
          <p className="text-sm text-muted-foreground mb-2">{status.reason}</p>
          <p className="text-xs text-muted-foreground">
            Server needs <code>OANDA_API_KEY</code> and <code>OANDA_ACCOUNT_ID</code>. Set <code>OANDA_ENV=practice</code> to use the demo endpoint.
          </p>
        </div>
      )}

      {status?.connected && (
        <div className="rounded-md border border-border bg-card p-5 mb-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
            <Wallet className="h-3.5 w-3.5" /> Account
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${status.env === "live" ? "bg-red-500/15 text-red-300" : "bg-primary/15 text-primary"}`}>
              {status.env.toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Metric label="Balance" value={fmtMoney(status.balance, status.currency)} />
            <Metric label="NAV" value={fmtMoney(status.nav, status.currency)} />
            <Metric label="Unrealized P/L" value={fmtMoney(status.unrealizedPL, status.currency)} />
            <Metric label="Open trades" value={String(status.openTradeCount)} />
          </div>
        </div>
      )}

      {status?.connected && (
        <div className="rounded-md border border-border bg-card p-5 mb-6">
          <div className="text-sm font-semibold mb-3">Place market order</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Symbol">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm" />
            </Field>
            <Field label="Side">
              <select value={side} onChange={(e) => setSide(e.target.value as "long" | "short")} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm">
                <option value="long">Buy</option>
                <option value="short">Sell</option>
              </select>
            </Field>
            <Field label="Units">
              <input type="number" value={units} onChange={(e) => setUnits(Number(e.target.value))} className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm" />
            </Field>
            <div />
            <Field label="Stop loss (optional)">
              <input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="price" className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm" />
            </Field>
            <Field label="Take profit (optional)">
              <input value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="price" className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm" />
            </Field>
          </div>
          <button
            onClick={submitOrder}
            disabled={placing || !symbol || units <= 0}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {placing ? "Placing…" : `Send ${side === "long" ? "BUY" : "SELL"} ${units} ${symbol}`}
          </button>
          <p className="text-xs text-muted-foreground mt-2">
            Orders route to OANDA {status.env}. Verify the symbol maps to an OANDA instrument (e.g. EUR/USD, XAU/USD, NAS100).
          </p>
        </div>
      )}

      {status?.connected && positions.length > 0 && (
        <div className="rounded-md border border-border bg-card p-5">
          <div className="text-sm font-semibold mb-3">Open positions</div>
          <div className="space-y-2">
            {positions.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground w-16">{p.id}</span>
                <span className="font-semibold">{p.instrument}</span>
                <span className={p.currentUnits > 0 ? "text-bull" : "text-red-300"}>
                  {p.currentUnits > 0 ? "LONG" : "SHORT"} {Math.abs(p.currentUnits)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">@ {p.price}</span>
                <span className={`ml-auto font-mono text-xs ${p.unrealizedPL >= 0 ? "text-bull" : "text-red-300"}`}>
                  {p.unrealizedPL >= 0 ? "+" : ""}{p.unrealizedPL.toFixed(2)}
                </span>
                <button onClick={() => handleClose(p.id)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border hover:bg-muted">
                  <X className="h-3 w-3" /> Close
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 text-xs text-muted-foreground">
        <Link to="/dashboard" className="inline-flex items-center gap-1 hover:text-foreground">
          <ExternalLink className="h-3 w-3" /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm mt-0.5">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function fmtMoney(v: number | null, ccy: string | null): string {
  if (v == null) return "-";
  return `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy ?? ""}`.trim();
}
