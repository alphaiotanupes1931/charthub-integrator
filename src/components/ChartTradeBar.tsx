import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { estimateBrokerMargin, getBrokerStatus, placeBrokerOrder } from "@/lib/broker-oanda.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Bottom-of-chart trade bar. Buy / Sell send a live order to the trader's
// connected broker account for the instrument shown on the chart, with the
// current plan's stop and target attached when the scan has them.
export function ChartTradeBar({
  tvSymbol,
  ticker,
  bias,
  entry,
  stop,
  takeProfit,
}: {
  tvSymbol: string;
  ticker?: string;
  interval?: string;
  bias?: "long" | "short" | "neutral";
  entry?: number | null;
  stop?: number | null;
  takeProfit?: number | null;
}) {
  const label = ticker ?? tvSymbol;
  const symbol = ticker ?? tvSymbol.split(":").pop() ?? tvSymbol;

  const fetchStatus = useServerFn(getBrokerStatus);
  const submitOrder = useServerFn(placeBrokerOrder);
  const fetchMargin = useServerFn(estimateBrokerMargin);

  const [side, setSide] = useState<"long" | "short" | null>(null);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getBrokerStatus>> | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [units, setUnits] = useState("1000");
  const [stopText, setStopText] = useState("");
  const [tpText, setTpText] = useState("");
  const [done, setDone] = useState<Awaited<ReturnType<typeof placeBrokerOrder>> | null>(null);
  const [margin, setMargin] = useState<Awaited<ReturnType<typeof estimateBrokerMargin>> | null>(null);
  const [loadingMargin, setLoadingMargin] = useState(false);

  const refresh = () => {
    setLoadingStatus(true);
    fetchStatus()
      .then((s) => setStatus(s))
      .catch(() => setStatus({ connected: false, reason: "Could not reach your broker." } as never))
      .finally(() => setLoadingStatus(false));
  };

  const loadMargin = () => {
    const size = Number(units);
    if (!Number.isFinite(size) || size <= 0) {
      setMargin(null);
      return;
    }
    setLoadingMargin(true);
    fetchMargin({ data: { symbol, units: size } })
      .then((m) => setMargin(m))
      .catch(() => setMargin(null))
      .finally(() => setLoadingMargin(false));
  };

  useEffect(() => {
    if (!side) return;
    setStopText(stop != null && Number.isFinite(stop) ? String(stop) : "");
    setTpText(takeProfit != null && Number.isFinite(takeProfit) ? String(takeProfit) : "");
    refresh();
    loadMargin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side]);

  useEffect(() => {
    if (!side) return;
    const t = setTimeout(loadMargin, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, side]);

  const close = () => { setSide(null); setStatus(null); setDone(null); setMargin(null); };

  const place = async () => {
    if (!side) return;
    const size = Number(units);
    if (!Number.isFinite(size) || size <= 0) {
      toast.error("Enter how many units to trade.");
      return;
    }
    const available = status && "marginAvailable" in status ? status.marginAvailable : null;
    if (available != null && available <= 0) {
      toast.error(
        `There is no money available to trade in your account right now. Add funds or close a position, then try again.`,
      );
      return;
    }
    if (margin?.required != null && available != null && margin.required > available) {
      toast.error(
        `This trade needs about ${margin.required.toFixed(2)} ${status?.currency ?? "USD"} but you only have ${available.toFixed(2)} available. Lower the units or add funds.`,
      );
      return;
    }
    const sl = Number(stopText);
    const tp = Number(tpText);
    setPlacing(true);
    try {
      const res = await submitOrder({
        data: {
          symbol,
          side,
          units: size,
          orderType: "market" as const,
          ...(Number.isFinite(sl) && sl > 0 ? { stopLoss: sl } : {}),
          ...(Number.isFinite(tp) && tp > 0 ? { takeProfit: tp } : {}),
        },
      });
      setDone(res);
      toast.success(
        `${side === "long" ? "Bought" : "Sold"} ${Math.abs(res.units)} ${label}${
          res.fillPrice ? ` at ${res.fillPrice}` : ""
        }`,
      );
    } catch (e) {
      toast.error((e as Error).message || "Your broker did not accept the order.");
    } finally {
      setPlacing(false);
    }
  };

  const connected = status?.connected === true;

  return (
    <>
      <div className="flex items-center gap-2 border-t border-border/60 bg-card px-3 py-2">
        <span className="hidden sm:inline text-[10px] font-mono tracking-tight text-muted-foreground">
          Trade {label} with your broker
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSide("long")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-2xl px-4 text-[11px] font-bold tracking-tight transition ${
              bias === "short"
                ? "border border-border/60 text-foreground hover:bg-muted/60"
                : "bg-bull text-background hover:opacity-90"
            }`}
            title={`Buy ${label} with your broker`}
          >
            <ArrowUpRight className="h-3.5 w-3.5" /> Buy
          </button>
          <button
            type="button"
            onClick={() => setSide("short")}
            className={`inline-flex h-8 items-center gap-1.5 rounded-2xl px-4 text-[11px] font-bold tracking-tight transition ${
              bias === "short"
                ? "bg-destructive text-destructive-foreground hover:opacity-90"
                : "border border-border/60 text-foreground hover:bg-muted/60"
            }`}
            title={`Sell ${label} with your broker`}
          >
            <ArrowDownRight className="h-3.5 w-3.5" /> Sell
          </button>
        </div>
      </div>

      <Dialog open={side != null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {done
                ? done.pending
                  ? "Order placed"
                  : `${side === "short" ? "Sold" : "Bought"} ${label}`
                : `${side === "short" ? "Sell" : "Buy"} ${label}`}
            </DialogTitle>
            <DialogDescription>
              {done
                ? "Your order went through on your connected account."
                : "This sends a real order to your connected live account right now."}
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2 rounded-xl border border-bull/40 bg-bull/10 px-3 py-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-bull" />
                <div className="space-y-1">
                  <p className="font-semibold text-foreground">
                    {done.pending ? "Your order is waiting for your price." : "Your trade is open."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Math.abs(done.units)} units of {label}
                    {done.fillPrice ? ` at ${done.fillPrice}` : ""}
                    {done.accountId ? ` · account ${done.accountId}` : ""}
                  </p>
                  {(Number(stopText) > 0 || Number(tpText) > 0) && (
                    <p className="text-xs text-muted-foreground">
                      {Number(stopText) > 0 ? `Stop loss ${stopText}` : ""}
                      {Number(stopText) > 0 && Number(tpText) > 0 ? " · " : ""}
                      {Number(tpText) > 0 ? `Take profit ${tpText}` : ""} attached.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">Reference {done.orderId}</p>
                </div>
              </div>
              <a
                href={done.brokerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
              >
                View it on your broker <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : loadingStatus ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your account…
            </div>
          ) : !connected ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {status && "reason" in status && status.reason
                  ? status.reason
                  : "No broker account is connected yet."}
              </p>
              <Link
                to="/broker"
                onClick={close}
                className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
              >
                Connect an account
              </Link>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                Account {status.accountId ?? "-"} · available to trade{" "}
                {status.marginAvailable != null
                  ? `${status.marginAvailable.toFixed(2)} ${status.currency ?? ""}`
                  : "-"}
              </div>
              {loadingMargin ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Calculating margin…
                </div>
              ) : margin?.required != null && Number.isFinite(margin.required) ? (
                <div className="rounded-xl border border-border/60 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">About </span>
                  <span className="font-semibold text-foreground">
                    {margin.required.toFixed(2)} {status.currency ?? "USD"}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}needed to open {Number(units).toLocaleString()} units at {margin.price}
                  </span>
                </div>
              ) : null}
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Units</span>
                <input
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Stop loss</span>
                  <input
                    value={stopText}
                    onChange={(e) => setStopText(e.target.value)}
                    inputMode="decimal"
                    placeholder="optional"
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Take profit</span>
                  <input
                    value={tpText}
                    onChange={(e) => setTpText(e.target.value)}
                    inputMode="decimal"
                    placeholder="optional"
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>
              {status.marginAvailable != null && status.marginAvailable <= 0 && (
                <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-foreground">
                  <p>
                    There is no money available to trade in this account, so the order would be
                    turned down. Add funds or close a position first.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={status.fundingUrl ?? "https://www.oanda.com/account/funding"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground"
                    >
                      Add funds at your broker <ExternalLink className="h-3 w-3" />
                    </a>
                    <button
                      type="button"
                      onClick={refresh}
                      disabled={loadingStatus}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/60 px-3 text-[11px] font-semibold disabled:opacity-60"
                    >
                      {loadingStatus ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Check again
                    </button>
                  </div>
                </div>
              )}
              {entry != null && Number.isFinite(entry) ? (
                <p className="text-[11px] text-muted-foreground">
                  Your current plan entry is {entry}. A market order fills at the live price, which
                  may differ.
                </p>
              ) : (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-foreground">
                  Run a scan first. Without a scan there is no entry, stop or target from a plan, so
                  Buy/Sell is disabled until you scan {label}.
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={close}
              className="h-9 rounded-xl border border-border/60 px-4 text-xs font-semibold"
            >
              {done ? "Done" : "Cancel"}
            </button>
            {connected && !done && (
              <button
                type="button"
                disabled={placing || entry == null || !Number.isFinite(entry)}
                onClick={place}
                className={`inline-flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-bold disabled:opacity-60 ${
                  side === "short"
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-bull text-background"
                }`}
              >
                {placing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Confirm {side === "short" ? "sell" : "buy"}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ChartTradeBar;
