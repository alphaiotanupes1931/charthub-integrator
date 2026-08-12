import { PageInstructions } from "@/components/PageInstructions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wallet, RefreshCw, X, ExternalLink, KeyRound, Trash2, ShieldCheck } from "lucide-react";
import {
  getBrokerStatus,
  listBrokerPositions,
  closeBrokerTrade,
  placeBrokerOrder,
} from "@/lib/broker-oanda.functions";
import {
  saveOandaCredentials,
  deleteOandaCredentials,
  getOandaCredentialsMeta,
} from "@/lib/broker-credentials.functions";

type BrokerSearch = {
  symbol?: string;
  side?: "long" | "short";
  entry?: number | string;
  stop?: number | string;
  tp?: number | string;
};

import { VenueRouter } from "@/components/VenueRouter";

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
type Meta = Awaited<ReturnType<typeof getOandaCredentialsMeta>>;

function BrokerPage() {
  const search = Route.useSearch();
  const fetchStatus = useServerFn(getBrokerStatus);
  const fetchPositions = useServerFn(listBrokerPositions);
  const closeTrade = useServerFn(closeBrokerTrade);
  const placeOrder = useServerFn(placeBrokerOrder);
  const saveCreds = useServerFn(saveOandaCredentials);
  const deleteCreds = useServerFn(deleteOandaCredentials);
  const fetchMeta = useServerFn(getOandaCredentialsMeta);

  const [status, setStatus] = useState<Status | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);

  // Credential form
  const [showCredForm, setShowCredForm] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [envSel, setEnvSel] = useState<"practice" | "live">("practice");

  // Order form
  const [symbol, setSymbol] = useState(search.symbol || "EUR/USD");
  const [side, setSide] = useState<"long" | "short">(search.side ?? "long");
  const [units, setUnits] = useState(1000);
  const [stopLoss, setStopLoss] = useState<string>(search.stop != null ? String(search.stop) : "");
  const [takeProfit, setTakeProfit] = useState<string>(search.tp != null ? String(search.tp) : "");

  // Risk sizer
  const [riskDollars, setRiskDollars] = useState<string>("");

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [s, m] = await Promise.all([fetchStatus(), fetchMeta()]);
      setStatus(s);
      setMeta(m);
      if (m.configured) {
        setAccountId(m.accountId ?? "");
        setEnvSel(m.env);
      }
      if (s.connected) {
        const p = await fetchPositions().catch(() => []);
        setPositions(p);
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


  async function submitCreds() {
    if (!apiKey.trim() || !accountId.trim()) {
      toast.error("API key and Account ID are required");
      return;
    }
    setSavingCreds(true);
    try {
      await saveCreds({ data: { apiKey: apiKey.trim(), accountId: accountId.trim(), env: envSel } });
      toast.success("OANDA credentials saved securely");
      setApiKey("");
      setShowCredForm(false);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingCreds(false);
    }
  }

  async function removeCreds() {
    if (!confirm("Remove your saved OANDA credentials?")) return;
    try {
      await deleteCreds();
      toast.success("Credentials removed");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
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
          <h1 className="font-display text-2xl md:text-3xl font-semibold mb-2">Broker: OANDA</h1>
          <p className="text-sm text-muted-foreground">
            Connect your own OANDA account to place real orders. Your API key is encrypted on the server and never exposed to the browser.
          </p>
        </div>
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <PageInstructions className="mb-6" />

      {/* Credentials card */}
      <div className="rounded-md border border-border bg-card p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">Your OANDA credentials</div>
          {meta?.configured && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400">
              <ShieldCheck className="h-3 w-3" /> encrypted
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {meta?.configured && !showCredForm && (
              <>
                <button
                  onClick={() => setShowCredForm(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-xs hover:bg-muted"
                >
                  Update
                </button>
                <button
                  onClick={removeCreds}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border text-xs hover:bg-muted text-red-300"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </>
            )}
            {!meta?.configured && !showCredForm && (
              <button
                onClick={() => setShowCredForm(true)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90"
              >
                Connect account
              </button>
            )}
          </div>
        </div>

        {meta?.configured && !showCredForm && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Metric label="Account ID" value={meta.accountId ?? "(discovered from key)"} />
            <Metric label="Environment" value={meta.env.toUpperCase()} />
            <Metric label="Updated" value={new Date(meta.updatedAt).toLocaleString()} />
          </div>
        )}

        {!meta?.configured && !showCredForm && (
          <p className="text-xs text-muted-foreground">
            You have not connected OANDA yet. Click Connect account to enter your API token and Account ID.
          </p>
        )}

        {showCredForm && (
          <div className="space-y-3">
            <Field label="API token">
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your OANDA API token"
                className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm font-mono"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Account ID">
                <input
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="e.g. 001-001-1234567-001"
                  className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm font-mono"
                />
              </Field>
              <Field label="Environment">
                <select
                  value={envSel}
                  onChange={(e) => setEnvSel(e.target.value as "practice" | "live")}
                  className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm"
                >
                  <option value="practice">Practice (demo)</option>
                  <option value="live">Live</option>
                </select>
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={submitCreds}
                disabled={savingCreds || !apiKey || !accountId}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {savingCreds ? "Saving..." : "Save & connect"}
              </button>
              <button
                onClick={() => { setShowCredForm(false); setApiKey(""); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-muted"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your API token is encrypted at rest with AES-256-GCM. It is only decrypted server-side when placing orders on your behalf. It is never sent to the browser.
              Get your token from OANDA: Manage Funds → API Access → Generate token.
            </p>
          </div>
        )}
      </div>

      {status && !status.connected && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-5 mb-6">
          <div className="font-semibold text-sm mb-1">Not connected</div>
          <p className="text-sm text-muted-foreground mb-2">{status.reason}</p>
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
          {status.usingDiscoveredAccount && (
            <p className="mt-3 text-xs text-muted-foreground">
              Using the account authorized by your saved OANDA key because the saved account ID did not match.
            </p>
          )}
        </div>
      )}

      {status?.connected && (
        <div className="rounded-md border border-border bg-card p-5 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-sm font-semibold">Place market order</div>
            {status.marginAvailable != null && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                Free margin: <span className="font-mono text-foreground">{fmtMoney(status.marginAvailable, status.currency)}</span>
              </span>
            )}
          </div>
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
          <div className="mt-3 flex items-end gap-2">
            <Field label="Dollar risk (auto-size units)">
              <input
                value={riskDollars}
                onChange={(e) => setRiskDollars(e.target.value)}
                placeholder="e.g. 100"
                className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm"
              />
            </Field>
            <button
              onClick={sizeFromRisk}
              className="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-muted"
            >
              Size from risk
            </button>
          </div>
          {status.marginAvailable != null && status.marginAvailable <= 0 && (
            <div className="mt-3 text-xs text-red-300">
              Free margin is 0. This order will be rejected by OANDA. Deposit or close positions first.
            </div>
          )}
          <button
            onClick={submitOrder}
            disabled={placing || !symbol || units <= 0 || (status.marginAvailable != null && status.marginAvailable <= 0)}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {placing ? "Placing..." : `Send ${side === "long" ? "BUY" : "SELL"} ${units.toLocaleString()} ${symbol}`}
          </button>
          <p className="text-xs text-muted-foreground mt-2">
            Orders route to OANDA {status.env}. If OANDA rejects (insufficient margin, halted instrument), you will see the exact reason instead of a fake fill.
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

      <div className="mt-6">
        <VenueRouter
          exclude={["oanda"]}
          prefill={{
            symbol: search.symbol ?? undefined,
            side: side === "long" ? "buy" : "sell",
            limitPrice: search.entry != null ? String(search.entry) : undefined,
            stopLoss: stopLoss || undefined,
            takeProfit: takeProfit || undefined,
          }}
        />
      </div>

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
      <div className="font-mono text-sm mt-0.5 break-all">{value}</div>
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
