import { normalizeOandaInstrument } from "@/lib/backtest/history.server";
import type { BtBar } from "@/lib/backtest/engine";

/** Replay a draw on its exact host/mid feed; never substitute Yahoo or another host. */
export async function exactScanHistory(symbol: string, feed: string, createdAt: string): Promise<BtBar[]> {
  const match = /^OANDA:(api-fxtrade\.oanda\.com|api-fxpractice\.oanda\.com):mid$/.exec(feed);
  const host = match?.[1];
  const instrument = normalizeOandaInstrument(symbol);
  const key = process.env.OANDA_API_KEY;
  if (!host || !instrument || !key) throw new Error("Exact scan feed unavailable");
  let from = new Date(createdAt).getTime();
  const bars: BtBar[] = [];
  for (let page = 0; page < 10; page++) {
    const response = await fetch(`https://${host}/v3/instruments/${instrument}/candles?granularity=M15&price=M&count=5000&from=${encodeURIComponent(new Date(from).toISOString())}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Exact scan feed unavailable");
    const json = await response.json() as { candles?: Array<{ time: string; complete: boolean; mid?: { o: string; h: string; l: string; c: string } }> };
    const candles = json.candles ?? [];
    for (const c of candles) {
      if (!c.complete || !c.mid) continue;
      const b = { time: Date.parse(c.time) / 1000, open: Number(c.mid.o), high: Number(c.mid.h), low: Number(c.mid.l), close: Number(c.mid.c) };
      if ([b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)) bars.push(b);
    }
    const last = candles.at(-1);
    if (!last || candles.length < 5000 || !last.complete) return bars;
    const next = Date.parse(last.time) + 900_000;
    if (next <= from) throw new Error("Scan history pagination stalled");
    from = next;
  }
  throw new Error("Scan history incomplete");
}