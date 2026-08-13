import { PageInstructions } from "@/components/PageInstructions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wallet, RefreshCw, X, ExternalLink, ArrowUpRight, ArrowDownRight, SlidersHorizontal, Scissors } from "lucide-react";
import {
  getBrokerStatus,
  listBrokerPositions,
  closeBrokerTrade,
  closeBrokerTradeUnits,
  modifyBrokerTrade,
  listBrokerPendingOrders,
  cancelBrokerOrder,
  placeBrokerOrder,
} from "@/lib/broker-oanda.functions";

type BrokerSearch = {
  symbol?: string;
  side?: "long" | "short";
  entry?: number | string;
  stop?: number | string;
  tp?: number | string;
};

import { AlpacaPanel } from "@/components/AlpacaPanel";
import { OandaConnectPanel } from "@/components/OandaConnectPanel";


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
      { title: "Brokers — TradeMind" },
      { name: "description", content: "Connect your Alpaca account and place real trades from your scans." },
      { property: "og:title", content: "Brokers — TradeMind" },
      { property: "og:description", content: "Connect your Alpaca account and place real trades from your scans." },
    ],
  }),
  component: BrokerPage,
});

type Status = Awaited<ReturnType<typeof getBrokerStatus>>;
type Position = Awaited<ReturnType<typeof listBrokerPositions>>[number];
type PendingOrder = Awaited<ReturnType<typeof listBrokerPendingOrders>>[number];

function BrokerPage() {
  const search = Route.useSearch();
  const fetchStatus = useServerFn(getBrokerStatus);
  const fetchPositions = useServerFn(listBrokerPositions);
  const closeTrade = useServerFn(closeBrokerTrade);
  const closeUnitsFn = useServerFn(closeBrokerTradeUnits);
  const modifyTrade = useServerFn(modifyBrokerTrade);
  const cancelOrder = useServerFn(cancelBrokerOrder);
  const fetchPending = useServerFn(listBrokerPendingOrders);
  const placeOrder = useServerFn(placeBrokerOrder);

  const [status, setStatus] = useState<Status | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);

  // Order form
  const [symbol, setSymbol] = useState(search.symbol || "EUR/USD");
  const [side, setSide] = useState<"long" | "short">(search.side ?? "long");
  const [units, setUnits] = useState(1000);
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
  const [limitPrice, setLimitPrice] = useState<string>(search.entry != null ? String(search.entry) : "");
  const [pending, setPending] = useState<PendingOrder[]>([]);
  const [stopLoss, setStopLoss] = useState<string>(search.stop != null ? String(search.stop) : "");
  const [takeProfit, setTakeProfit] = useState<string>(search.tp != null ? String(search.tp) : "");

  // Risk sizer
  const [riskDollars, setRiskDollars] = useState<string>("");

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const s = await fetchStatus();
      setStatus(s);
      if (s.connected) {
        const [p, po] = await Promise.all([
          fetchPositions().catch(() => []),
          fetchPending().catch(() => [] as PendingOrder[]),
        ]);
        setPositions(p);
        setPending(po);
      }
    } catch (e) {
      if (!silent) toast.error((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Live poll every 5s when connected
  useEffect(() => {
    if (!status?.connected) return;
    const t = setInterval(() => refresh(true), 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  function sizeFromRisk() {
    const risk = Number(riskDollars);
    const sl = Number(stopLoss);
    const entryHint = Number(search.entry);
    if (!risk || risk <= 0) { toast.error("Enter a dollar risk amount"); return; }
    if (!sl || sl <= 0) { toast.error("Enter a stop-loss price first"); return; }
    if (!entryHint || entryHint <= 0) { toast.error("No entry price yet — run a scan or set entry on the signal card"); return; }
    const perUnit = Math.abs(entryHint - sl);
    if (perUnit <= 0) { toast.error("Stop must differ from entry"); return; }
    const u = Math.max(1, Math.floor(risk / perUnit));
    setUnits(u);
    toast.success(`Sized to ${u.toLocaleString()} units for $${risk} risk`);
  }


  async function submitOrder(overrideSide?: "long" | "short") {
    const useSide = overrideSide ?? side;
    setPlacing(true);
    try {
      const res = await placeOrder({
        data: {
          symbol,
          side: useSide,
          units,
          orderType,
          price: orderType === "market" ? undefined : Number(limitPrice) || undefined,
          stopLoss: stopLoss ? Number(stopLoss) : undefined,
          takeProfit: takeProfit ? Number(takeProfit) : undefined,
        },
      });
      toast.success(
        res.pending
          ? `Working ${orderType.toUpperCase()} order placed at ${limitPrice}`
          : `Order filled${res.fillPrice ? ` at ${res.fillPrice}` : ""}`,
      );
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPlacing(false);
    }
  }

  async function handleClose(id: string, closeUnits?: number) {
    if (!closeUnits && !confirm("Close this trade at market?")) return;
    try {
      await closeUnitsFn({ data: { tradeId: id, units: closeUnits } });
      toast.success(closeUnits ? `Closed ${closeUnits} units` : "Trade closed");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveProtection(id: string, sl: string, tp: string, trail: string) {
    try {
      await modifyTrade({
        data: {
          tradeId: id,
          stopLoss: sl.trim() === "" ? null : Number(sl),
          takeProfit: tp.trim() === "" ? null : Number(tp),
          ...(trail.trim() === "" ? {} : { trailingStopDistance: Number(trail) }),
        },
      });
      toast.success("Trade updated on OANDA");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleCancelOrder(id: string) {
    try {
      await cancelOrder({ data: { orderId: id } });
      toast.success("Working order cancelled");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }


  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold mb-2">Brokers</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to OANDA once, then place trades straight from your scans. Your token is encrypted on the server and never exposed to the browser.
          </p>

        </div>
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <PageInstructions className="mb-6" />

      <OandaConnectPanel onChange={() => refresh()} />



      {status?.connected && (
        <div className="rounded-xl border border-border/60 bg-card p-5 mb-6">
          <div className="flex items-center gap-2 text-xs tracking-tight text-muted-foreground mb-3">
            <Wallet className="h-3.5 w-3.5" /> Account
            <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${status.env === "live" ? "bg-red-500/15 text-red-300" : "bg-primary/15 text-primary"}`}>
              {status.env === "practice" ? "DEMO" : "LIVE"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Metric label="Balance" value={fmtMoney(status.balance, status.currency)} />
            <Metric label="NAV" value={fmtMoney(status.nav, status.currency)} />
            <Metric label="Unrealized P/L" value={fmtMoney(status.unrealizedPL, status.currency)} />
            <Metric label="Open trades" value={String(status.openTradeCount)} />
          </div>
          {status.usingDiscoveredAccount && (
            <p className="mt-3 text-xs text-muted-foreground">
              Using the account authorized by your saved OANDA key because the saved account ID did not match.
            </p>
          )}
        </div>
      )}

      {status?.connected && (
        <div className="rounded-xl border border-border/60 bg-card p-5 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-sm font-semibold">Order ticket</div>
            {status.marginAvailable != null && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                Free margin: <span className="font-mono text-foreground">{fmtMoney(status.marginAvailable, status.currency)}</span>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Symbol">
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
            <Field label="Order type">
              <select value={orderType} onChange={(e) => setOrderType(e.target.value as "market" | "limit" | "stop")} className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm">
                <option value="market">Market (now)</option>
                <option value="limit">Limit (better price)</option>
                <option value="stop">Stop (breakout)</option>
              </select>
            </Field>
            <Field label="Units">
              <input type="number" value={units} onChange={(e) => setUnits(Number(e.target.value))} className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
            <Field label={orderType === "market" ? "Entry price (market)" : "Entry price"}>
              <input
                value={orderType === "market" ? "" : limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                disabled={orderType === "market"}
                placeholder={orderType === "market" ? "at market" : "price"}
                className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm disabled:opacity-50"
              />
            </Field>
            <Field label="Stop loss">
              <input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="price" className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
            <Field label="Take profit">
              <input value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="price" className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
            <Field label="Dollar risk (auto-size units)">
              <input
                value={riskDollars}
                onChange={(e) => setRiskDollars(e.target.value)}
                placeholder="e.g. 100"
                className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm"
              />
            </Field>
            <div className="flex items-end">
              <button
                onClick={sizeFromRisk}
                className="w-full px-3 py-1.5 rounded-xl border border-border/60 text-xs hover:bg-muted"
              >
                Size from risk
              </button>
            </div>
          </div>
          {status.marginAvailable != null && status.marginAvailable <= 0 && (
            <div className="mt-3 text-xs text-red-300">
              Free margin is 0. This order will be rejected by OANDA. Deposit or close positions first.
            </div>
          )}
          {orderType !== "market" && !Number(limitPrice) && (
            <div className="mt-3 text-xs text-amber-300">
              Enter an entry price for a {orderType} order. Buy stop sits above price, buy limit below.
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setSide("long"); submitOrder("long"); }}
              disabled={placing || !symbol || units <= 0 || (orderType !== "market" && !Number(limitPrice)) || (status.marginAvailable != null && status.marginAvailable <= 0)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-bull/15 border border-bull/40 text-bull text-sm font-semibold hover:bg-bull/25 disabled:opacity-50"
            >
              <ArrowUpRight className="h-4 w-4" />
              {placing ? "Sending..." : `BUY ${orderType === "market" ? "" : orderType.toUpperCase() + " "}${units.toLocaleString()}`}
            </button>
            <button
              onClick={() => { setSide("short"); submitOrder("short"); }}
              disabled={placing || !symbol || units <= 0 || (orderType !== "market" && !Number(limitPrice)) || (status.marginAvailable != null && status.marginAvailable <= 0)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-sm font-semibold hover:bg-red-500/25 disabled:opacity-50"
            >
              <ArrowDownRight className="h-4 w-4" />
              {placing ? "Sending..." : `SELL / SHORT ${orderType === "market" ? "" : orderType.toUpperCase() + " "}${units.toLocaleString()}`}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Selling on OANDA opens a short position, so SELL is your short button. Orders route to OANDA {status.env}. If OANDA rejects (insufficient margin, halted instrument) you see the exact reason instead of a fake fill.
          </p>

        </div>
      )}

      {status?.connected && pending.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-5 mb-6">
          <div className="text-sm font-semibold mb-3">Working orders (not filled yet)</div>
          <div className="space-y-2">
            {pending.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground w-16">{o.id}</span>
                <span className="font-semibold">{o.instrument}</span>
                <span className="text-[10px] tracking-tight rounded px-1.5 py-0.5 border border-border/60">{o.type}</span>
                <span className={o.units > 0 ? "text-bull" : "text-red-300"}>
                  {o.units > 0 ? "BUY" : "SELL"} {Math.abs(o.units)}
                </span>
                <span className="font-mono text-xs text-muted-foreground">@ {o.price ?? "-"}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  SL {o.stopLoss ?? "-"} / TP {o.takeProfit ?? "-"}
                </span>
                <button onClick={() => handleCancelOrder(o.id)} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border/60 hover:bg-muted">
                  <X className="h-3 w-3" /> Cancel
                </button>
              </div>
            ))}
          </div>
        </div>
      )}


      {status?.connected && positions.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <div className="text-sm font-semibold mb-3">Open positions</div>
          <p className="text-xs text-muted-foreground mb-3">
            Adjust stop loss, take profit, or a trailing stop and it is sent straight to OANDA. You can also close part of a position to bank partials.
          </p>
          <div className="space-y-2">
            {positions.map((p) => (
              <PositionRow
                key={p.id}
                position={p}
                onClose={handleClose}
                onSaveProtection={saveProtection}
              />
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
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <div className="text-[10px] tracking-tight text-muted-foreground">{label}</div>
      <div className="font-mono text-sm mt-0.5 break-all">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-tight text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function fmtMoney(v: number | null, ccy: string | null): string {
  if (v == null) return "-";
  return `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy ?? ""}`.trim();
}

function PositionRow({
  position,
  onClose,
  onSaveProtection,
}: {
  position: Position;
  onClose: (id: string, units?: number) => void;
  onSaveProtection: (id: string, sl: string, tp: string, trail: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [sl, setSl] = useState(position.stopLoss != null ? String(position.stopLoss) : "");
  const [tp, setTp] = useState(position.takeProfit != null ? String(position.takeProfit) : "");
  const [trail, setTrail] = useState("");
  const [partial, setPartial] = useState(String(Math.max(1, Math.floor(Math.abs(position.currentUnits) / 2))));
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-xl border border-border/60">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
        <span className="font-mono text-xs text-muted-foreground w-16">{position.id}</span>
        <span className="font-semibold">{position.instrument}</span>
        <span className={position.currentUnits > 0 ? "text-bull" : "text-red-300"}>
          {position.currentUnits > 0 ? "LONG" : "SHORT"} {Math.abs(position.currentUnits)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">@ {position.price}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          SL {position.stopLoss ?? "-"} / TP {position.takeProfit ?? "-"}
        </span>
        <span className={`ml-auto font-mono text-xs ${position.unrealizedPL >= 0 ? "text-bull" : "text-red-300"}`}>
          {position.unrealizedPL >= 0 ? "+" : ""}{position.unrealizedPL.toFixed(2)}
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border/60 hover:bg-muted"
        >
          <SlidersHorizontal className="h-3 w-3" /> Adjust
        </button>
        <button onClick={() => onClose(position.id)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border/60 hover:bg-muted">
          <X className="h-3 w-3" /> Close
        </button>
      </div>

      {open && (
        <div className="border-t border-border/60 px-3 py-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Stop loss">
              <input value={sl} onChange={(e) => setSl(e.target.value)} placeholder="blank = remove" className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
            <Field label="Take profit">
              <input value={tp} onChange={(e) => setTp(e.target.value)} placeholder="blank = remove" className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
            <Field label="Trailing stop distance">
              <input value={trail} onChange={(e) => setTrail(e.target.value)} placeholder="e.g. 0.0050" className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
            <Field label="Partial close units">
              <input value={partial} onChange={(e) => setPartial(e.target.value)} className="w-full px-2 py-1.5 rounded-xl bg-background border border-border/60 text-sm" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={async () => { setSaving(true); await onSaveProtection(position.id, sl, tp, trail); setSaving(false); }}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes to OANDA"}
            </button>
            <button
              onClick={() => {
                const u = Number(partial);
                if (!u || u <= 0) return;
                onClose(position.id, Math.min(u, Math.abs(position.currentUnits)));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/60 text-xs hover:bg-muted"
            >
              <Scissors className="h-3 w-3" /> Close partial
            </button>
            <button
              onClick={() => { setSl(String(position.price)); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border/60 text-xs hover:bg-muted"
            >
              Move stop to breakeven
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

