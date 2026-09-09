import { PageInstructions } from "@/components/PageInstructions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wallet, RefreshCw, X, ExternalLink, SlidersHorizontal, Scissors } from "lucide-react";
import {
  getBrokerStatus,
  listBrokerPositions,
  closeBrokerTrade,
  closeBrokerTradeUnits,
  modifyBrokerTrade,
  listBrokerPendingOrders,
  cancelBrokerOrder,
} from "@/lib/broker-oanda.functions";

type BrokerSearch = {
  symbol?: string;
  side?: "long" | "short";
  entry?: number | string;
  stop?: number | string;
  tp?: number | string;
};

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
      { name: "description", content: "Sign in to OANDA and place real trades straight from your scans." },
      { property: "og:title", content: "Brokers — TradeMind" },
      { property: "og:description", content: "Sign in to OANDA and place real trades straight from your scans." },
    ],
  }),
  component: BrokerPage,
});

type Status = Awaited<ReturnType<typeof getBrokerStatus>>;
type Position = Awaited<ReturnType<typeof listBrokerPositions>>[number];
type PendingOrder = Awaited<ReturnType<typeof listBrokerPendingOrders>>[number];

function BrokerPage() {
  const fetchStatus = useServerFn(getBrokerStatus);
  const fetchPositions = useServerFn(listBrokerPositions);
  const closeTrade = useServerFn(closeBrokerTrade);
  const closeUnitsFn = useServerFn(closeBrokerTradeUnits);
  const modifyTrade = useServerFn(modifyBrokerTrade);
  const cancelOrder = useServerFn(cancelBrokerOrder);
  const fetchPending = useServerFn(listBrokerPendingOrders);

  const [status, setStatus] = useState<Status | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOrder[]>([]);



  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const s = await fetchStatus();
      setStatus(s);
      setLoadError(null);
      if (s.connected) {
        const [p, po] = await Promise.all([
          fetchPositions().catch(() => []),
          fetchPending().catch(() => [] as PendingOrder[]),
        ]);
        setPositions(p);
        setPending(po);
      }
    } catch (e) {
      const message = (e as Error).message || "Could not reach your broker connection";
      setLoadError(message);
      if (!silent) toast.error(message);
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

      {loadError && (
        <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 animate-fade-in">
          <div className="text-sm font-semibold text-foreground">Broker connection failed</div>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          <button
            onClick={() => refresh()}
            disabled={loading}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 press-in"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Retrying…" : "Retry connection"}
          </button>
        </div>
      )}

      <OandaConnectPanel onChange={() => refresh()} />

      <div className="rounded-xl border border-border/60 bg-card p-5 mb-6">
        <div className="text-sm font-semibold">Account used for Auto Trading</div>
        <p className="mt-1 text-xs text-muted-foreground">
          OANDA is your default account, so approved setups are placed and managed there. Switch Auto Trading on from
          the home page; sign out above at any time and nothing can be placed.
        </p>
      </div>





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

