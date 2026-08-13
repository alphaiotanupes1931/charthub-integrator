import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send } from "lucide-react";
import { placeVenueOrder } from "@/lib/brokers.functions";

/**
 * Minimal manual order ticket for a connected venue that supports routing.
 * Credentials stay server-side; this only sends order intent.
 */
export function VenueOrderTicket({
  broker,
  venueName,
  initial,
}: {
  broker: string;
  venueName: string;
  initial?: {
    symbol?: string;
    side?: "buy" | "sell";
    limitPrice?: string;
    stopLoss?: string;
    takeProfit?: string;
  };
}) {
  const place = useServerFn(placeVenueOrder);
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [side, setSide] = useState<"buy" | "sell">(initial?.side ?? "buy");
  const [qty, setQty] = useState("");
  const [type, setType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState(initial?.limitPrice ?? "");
  const [stopLoss, setStopLoss] = useState(initial?.stopLoss ?? "");
  const [takeProfit, setTakeProfit] = useState(initial?.takeProfit ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  async function submit() {
    const quantity = num(qty);
    if (!symbol.trim() || !quantity) {
      setMsg({ ok: false, text: "Enter a symbol and a quantity above zero." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await place({
        data: {
          broker,
          symbol: symbol.trim(),
          side,
          quantity,
          type,
          limitPrice: type === "limit" ? num(limitPrice) : undefined,
          stopLoss: num(stopLoss),
          takeProfit: num(takeProfit),
        },
      });
      setMsg({ ok: res.ok, text: res.detail });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Order failed." });
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-xl border border-border/60 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground";

  return (
    <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
      <p className="text-xs text-muted-foreground">
        Send a live order to {venueName}. Use the venue's own symbol format.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-muted-foreground">Symbol</span>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} className={field} placeholder="EUR_USD / AAPL / BTC-USD" />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Quantity</span>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={field} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded-xl border px-2.5 py-1 text-xs uppercase ${
              side === s ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="mx-1 w-px bg-border" />
        {(["market", "limit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-xl border px-2.5 py-1 text-xs uppercase ${
              type === t ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {type === "limit" ? (
          <label className="block">
            <span className="text-xs text-muted-foreground">Limit</span>
            <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal" className={field} />
          </label>
        ) : null}
        <label className="block">
          <span className="text-xs text-muted-foreground">Stop loss</span>
          <input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} inputMode="decimal" className={field} />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Take profit</span>
          <input value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} inputMode="decimal" className={field} />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="inline-flex items-center gap-2 rounded-xl border border-foreground bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        Send order
      </button>
      {msg ? (
        <p className={`text-xs ${msg.ok ? "text-foreground" : "text-destructive"}`}>{msg.text}</p>
      ) : null}
    </div>
  );
}
