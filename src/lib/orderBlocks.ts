// Order Blocks (ICT style) — the last opposing candle before a displacement
// leg that breaks structure. Boxes are drawn from the origin candle and extend
// to the right until price mitigates (trades back through) them.

export type ObCandle = { time: number; open: number; high: number; low: number; close: number };

export type OrderBlock = {
  kind: "bullish" | "bearish";
  /** top / bottom of the block in price */
  top: number;
  bot: number;
  /** candle time the block originates from */
  time: number;
  /** time price first traded back into the block (null = still fresh) */
  mitigatedTime: number | null;
  mitigated: boolean;
  /** how many separate times price has traded back into the block */
  mitigations: number;

  /** displacement size in ATR multiples — bigger = stronger */
  strength: number;
  /** structure level the displacement leg broke */
  breakLevel: number;
};

export type RankedOrderBlock = OrderBlock & {
  /** 0-100 deterministic quality score used by the entry planner. */
  quality: number;
  qualityLabel: "high" | "medium" | "low";
  aligned: boolean;
  liquiditySweep: boolean;
  distanceAtr: number;
};

export const OB_COLORS = {
  bullish: "#2dd4bf",
  bearish: "#f87171",
};

function atr(candles: ObCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const slice = candles.slice(-Math.max(period + 1, 2));
  let sum = 0;
  let n = 0;
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i];
    const p = slice[i - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Detect order blocks.
 * A bullish OB = last down-close candle before an up leg that closes above the
 * prior swing high. A bearish OB = last up-close candle before a down leg that
 * closes below the prior swing low.
 */
export function computeOrderBlocks(candles: ObCandle[], opts?: { max?: number; swing?: number }): OrderBlock[] {
  const max = opts?.max ?? 6;
  const swing = opts?.swing ?? 5;
  if (candles.length < swing * 3) return [];

  const a = atr(candles);
  if (!(a > 0)) return [];

  const blocks: OrderBlock[] = [];

  for (let i = swing; i < candles.length; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    // displacement filter: the breaking candle must be meaningful
    if (body < a * 0.6) continue;

    const priorHigh = Math.max(...candles.slice(i - swing, i).map((x) => x.high));
    const priorLow = Math.min(...candles.slice(i - swing, i).map((x) => x.low));

    const bullBreak = c.close > priorHigh && c.close > c.open;
    const bearBreak = c.close < priorLow && c.close < c.open;
    if (!bullBreak && !bearBreak) continue;

    // walk back to the last opposing candle — that is the block
    let originIdx = -1;
    for (let j = i - 1; j >= Math.max(0, i - swing * 2); j--) {
      const o = candles[j];
      if (bullBreak && o.close < o.open) { originIdx = j; break; }
      if (bearBreak && o.close > o.open) { originIdx = j; break; }
    }
    if (originIdx < 0) continue;

    const origin = candles[originIdx];
    const block: OrderBlock = {
      kind: bullBreak ? "bullish" : "bearish",
      top: Math.max(origin.open, origin.close, bullBreak ? origin.open : origin.high),
      bot: Math.min(origin.open, origin.close, bullBreak ? origin.low : origin.open),
      time: origin.time,
      mitigatedTime: null,
      mitigated: false,
      mitigations: 0,
      strength: Number((body / a).toFixed(2)),
      breakLevel: bullBreak ? priorHigh : priorLow,
    };
    // Use the candle range for a cleaner ICT-style block
    block.top = Math.max(origin.open, origin.close);
    block.bot = Math.min(origin.open, origin.close);
    if (block.top - block.bot < a * 0.15) {
      block.top = origin.high;
      block.bot = origin.low;
    }

    // mitigation: price trades back into the block after the displacement.
    // Count each separate visit (price must leave the block before the next one
    // counts) so a level that keeps getting run through reads as worn out.
    let inside = false;
    for (let k = i + 1; k < candles.length; k++) {
      const f = candles[k];
      const touched = f.low <= block.top && f.high >= block.bot;
      if (touched) {
        if (!inside) {
          block.mitigations += 1;
          if (!block.mitigated) { block.mitigatedTime = f.time; block.mitigated = true; }
        }
        inside = true;
      } else {
        inside = false;
      }
    }


    // de-duplicate overlapping blocks of the same direction
    const dup = blocks.some(
      (b) => b.kind === block.kind && Math.abs(b.top - block.top) < a * 0.4 && Math.abs(b.bot - block.bot) < a * 0.4,
    );
    if (!dup) blocks.push(block);
  }

  // newest first, fresh blocks prioritised
  const sorted = blocks.sort((x, y) => {
    if (x.mitigated !== y.mitigated) return x.mitigated ? 1 : -1;
    return y.time - x.time;
  });
  return sorted.slice(0, max);
}

/**
 * Rank blocks for execution rather than drawing. Freshness and displacement
 * carry most of the score; higher-timeframe alignment and a nearby swept
 * liquidity level distinguish the institutional-quality blocks from noise.
 */
export function rankOrderBlocks(
  blocks: OrderBlock[],
  options: {
    bias: "bullish" | "bearish";
    price: number;
    atr: number;
    h4Direction?: "bullish" | "bearish" | "neutral";
    sweptLiquidity?: number[];
  },
): RankedOrderBlock[] {
  const atrValue = Math.max(options.atr, Math.abs(options.price) * 1e-6);
  const liquidity = options.sweptLiquidity ?? [];
  return blocks
    .filter((block) => block.kind === options.bias)
    .map((block) => {
      const nearEdge = options.bias === "bullish" ? block.top : block.bot;
      const distanceAtr = Math.abs(options.price - nearEdge) / atrValue;
      const aligned = options.h4Direction === options.bias;
      const liquiditySweep = liquidity.some((level) =>
        Number.isFinite(level) && Math.abs(level - block.breakLevel) <= atrValue * 0.35,
      );
      const freshness = block.mitigations === 0 ? 38 : block.mitigations === 1 ? 16 : 0;
      const displacement = Math.min(28, Math.max(0, block.strength) * 14);
      const alignment = aligned ? 18 : 0;
      const sweep = liquiditySweep ? 10 : 0;
      const proximity = distanceAtr <= 1.5 ? 6 : distanceAtr <= 2.2 ? 2 : 0;
      const quality = Math.round(Math.min(100, freshness + displacement + alignment + sweep + proximity));
      return {
        ...block,
        quality,
        qualityLabel: quality >= 75 ? "high" : quality >= 55 ? "medium" : "low",
        aligned,
        liquiditySweep,
        distanceAtr: Number(distanceAtr.toFixed(2)),
      } satisfies RankedOrderBlock;
    })
    .sort((a, b) => b.quality - a.quality || a.distanceAtr - b.distanceAtr || b.time - a.time);
}

export function obLabel(b: OrderBlock): string {
  const dir = b.kind === "bullish" ? "Bull OB" : "Bear OB";
  return `${dir}${b.mitigated ? " (mitigated)" : ""} · ${b.strength}x`;
}
