// Offer popup: a scan came back at or above the trader's minimum grade while
// Auto Trading is on, so they are asked whether to place it. Nothing is sent
// until they tap Place trade.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bot, X } from "lucide-react";
import { placeAutoTrade, previewAutoTrade, skipAutoTrade } from "@/lib/auto-trade.functions";
import { AUTO_TRADE_CONTEXT_KEY } from "@/components/AutoTradingToggle";

export type TradeOffer = {
  symbol: string;
  label: string;
  timeframe: string;
  side: "long" | "short";
  grade: string;
  confidence: number | null;
  entry: number;
  stop: number;
  target: number | null;
  reasoning: string | null;
  decimals: number;
};

export function TradeOfferDialog({
  offer,
  onClose,
}: {
  offer: TradeOffer | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const preview = useServerFn(previewAutoTrade);
  const place = useServerFn(placeAutoTrade);
  const skip = useServerFn(skipAutoTrade);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setClosing(false);
  }, [offer?.symbol, offer?.entry]);

  const sizing = useQuery({
    queryKey: ["autoTrade", "preview", offer?.symbol, offer?.entry, offer?.stop],
    queryFn: () => preview({ data: { entry: offer!.entry, stop: offer!.stop } }),
    enabled: Boolean(offer),
    retry: false,
  });

  const placeMutation = useMutation({
    mutationFn: () =>
      place({
        data: {
          symbol: offer!.symbol,
          timeframe: offer!.timeframe,
          side: offer!.side,
          grade: offer!.grade,
          confidence: offer!.confidence ?? undefined,
          entry: offer!.entry,
          stopLoss: offer!.stop,
          takeProfit: offer!.target ?? undefined,
          reasoning: offer!.reasoning ?? undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Trade placed. ${res.detail}`);
      qc.invalidateQueries({ queryKey: AUTO_TRADE_CONTEXT_KEY });
      qc.invalidateQueries({ queryKey: ["autopilot"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!offer) return null;
  const fmt = (n: number) => n.toFixed(offer.decimals);
  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    void skip({ data: { symbol: offer.symbol, grade: offer.grade } }).catch(() => undefined);
    onClose();
  };
  const currency = sizing.data?.currency ?? "";
  const units = sizing.data?.units ?? null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="h-4 w-4 text-emerald-400" />
              Trade this {offer.grade} setup?
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {offer.label} · {offer.side === "long" ? "Buy" : "Sell"} · {offer.timeframe}
              {offer.confidence === null ? "" : ` · ${offer.confidence}% conviction`}
            </p>
          </div>
          <button type="button" onClick={dismiss} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-border/60 p-3">
            <div className="text-muted-foreground">Entry</div>
            <div className="mt-1 font-mono text-sm">{fmt(offer.entry)}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <div className="text-muted-foreground">Stop</div>
            <div className="mt-1 font-mono text-sm text-red-400">{fmt(offer.stop)}</div>
          </div>
          <div className="rounded-xl border border-border/60 p-3">
            <div className="text-muted-foreground">Target</div>
            <div className="mt-1 font-mono text-sm text-emerald-400">
              {offer.target === null ? "-" : fmt(offer.target)}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-border/60 p-3 text-xs">
          {sizing.isLoading && <span className="text-muted-foreground">Checking your account size…</span>}
          {sizing.isError && (
            <span className="text-red-400">Your account could not be read right now, so no size was worked out.</span>
          )}
          {sizing.data && !sizing.data.connected && (
            <div className="space-y-2">
              <p className="font-medium text-amber-400">No broker account is connected.</p>
              <p className="text-muted-foreground">
                Connect your broker so TradeMind can size, place, and manage this trade.
              </p>
              <Link
                to="/broker"
                className="inline-flex items-center rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                onClick={dismiss}
              >
                Connect broker
              </Link>
            </div>
          )}
          {sizing.data && sizing.data.connected && (
            <div className="space-y-1">
              <div>
                Size: <span className="font-mono">{units ?? "-"}</span> units
              </div>
              <div className="text-muted-foreground">
                Risking {sizing.data.riskPct}% of your account, about {currency} {sizing.data.riskAmount} if the stop is
                hit. The stop and target are attached to the order.
              </div>
            </div>
          )}
        </div>

        {offer.reasoning && (
          <p className="mt-3 max-h-24 overflow-y-auto text-xs leading-relaxed text-muted-foreground">
            {offer.reasoning}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={placeMutation.isPending || !units}
            onClick={() => placeMutation.mutate()}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {placeMutation.isPending ? "Placing…" : !units ? "Connect broker to trade" : "Place trade"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl border border-border/60 px-4 py-2 text-xs font-semibold"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
