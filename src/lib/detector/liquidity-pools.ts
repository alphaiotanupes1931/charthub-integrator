import type { Candle } from "@/lib/agents/types";

export type PoolSide = "buyside" | "sellside";
export type PoolFrame = "15m" | "1H" | "4H" | "Daily";
export type LiquidityPool = {
  id: string; side: PoolSide; price: number; time: number; confirmedAt: number;
  frame: PoolFrame; kind: "swing" | "equal" | "session";
  status: "unswept" | "swept" | "closed-through";
};
export type PoolSeries = Partial<Record<PoolFrame, Candle[]>>;
const SECONDS: Record<PoolFrame, number> = { "15m": 900, "1H": 3600, "4H": 14400, Daily: 86400 };

/** Prefix-only pool map. A pivot is available only after its two right bars close. */
export function mapLiquidityPools(series: PoolSeries, asOf: number): LiquidityPool[] {
  const result: LiquidityPool[] = [];
  for (const frame of Object.keys(series) as PoolFrame[]) {
    const bars = (series[frame] ?? []).filter(b => b.time + SECONDS[frame] <= asOf);
    const add = (side: PoolSide, price: number, time: number, confirmedAt: number, kind: LiquidityPool["kind"]) => {
      if (!Number.isFinite(price) || price <= 0) return;
      const after = bars.filter(b => b.time >= confirmedAt);
      const through = after.some(b => side === "buyside" ? b.close > price : b.close < price);
      const wicked = after.some(b => side === "buyside" ? b.high > price : b.low < price);
      result.push({ id: `${frame}:${side}:${time}:${price}`, frame, side, price, time, confirmedAt, kind,
        status: through ? "closed-through" : wicked ? "swept" : "unswept" });
    };
    for (let i = 2; i + 2 < bars.length; i++) {
      const b = bars[i], left = bars[i - 1], left2 = bars[i - 2], right = bars[i + 1], right2 = bars[i + 2];
      if (!b || !left || !left2 || !right || !right2) continue;
      for (const side of ["buyside", "sellside"] as const) {
        const p = side === "buyside" ? b.high : b.low;
        const peers = [left, left2, right, right2].map(x => side === "buyside" ? x.high : x.low);
        if (side === "buyside" ? peers.every(x => p >= x) && peers.some(x => p > x) : peers.every(x => p <= x) && peers.some(x => p < x)) {
          const previous = result.filter(x => x.frame === frame && x.side === side).at(-1);
          const equal = previous && Math.abs(previous.price - p) <= p * 0.0001;
          add(side, p, b.time, right2.time + SECONDS[frame], equal ? "equal" : "swing");
        }
      }
    }
    // Completed UTC session windows, labelled explicitly; never the forming session.
    if (frame === "15m") {
      const groups = new Map<number, Candle[]>();
      for (const b of bars) {
        const bucket = Math.floor(b.time / 21600) * 21600;
        groups.set(bucket, [...(groups.get(bucket) ?? []), b]);
      }
      for (const [start, group] of groups) {
        if (start + 21600 > asOf || group.length < 4) continue;
        add("buyside", Math.max(...group.map(b => b.high)), start, start + 21600, "session");
        add("sellside", Math.min(...group.map(b => b.low)), start, start + 21600, "session");
      }
    }
  }
  return result;
}

export function orderedPools(pools: LiquidityPool[], side: PoolSide, price: number): LiquidityPool[] {
  const sorted = pools.filter(p => p.side === side && p.status === "unswept" && (side === "buyside" ? p.price > price : p.price < price))
    .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price));
  return sorted.filter((p, i) => !sorted.slice(0, i).some(q => Math.abs(q.price - p.price) <= p.price * 0.00001));
}