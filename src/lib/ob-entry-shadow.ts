// Order-block entry, in trial (shadow) only.
//
// Rule under test: the break of structure is confirmation, never the entry. The
// entry is the retest into the 1H order block, refined to the 15m order block
// that sits inside it. No 1H order block on the right side of price = no entry.
//
// Live signals keep their current entry. This is filed beside them so the two can
// be compared on forward results before anything switches.

import { computeOrderBlocks, type ObCandle, type OrderBlock } from "@/lib/orderBlocks";

export type ObEntryShadow = {
  entry: number;
  stop: number;
  /** Which block set the entry. */
  source: "15m inside 1H" | "1H";
  label: string;
  h1: { top: number; bot: number; time: number };
  m15: { top: number; bot: number; time: number } | null;
  riskAtr: number;
  /** Signed difference vs the live entry, in ATR. Positive = deeper than live. */
  entryShiftAtr: number | null;
  note: string;
  /** Stricter sequence: BOS -> CHoCH -> FVG -> order block (all on 1H, after the block). */
  strict: { choch: boolean; fvg: boolean; pass: boolean };
};

/** A fair value gap in the signal direction formed within 3 bars after the block candle. */
export function hasAdjacentFvg(candles: ObCandle[], blockTime: number, long: boolean): boolean {
  const i0 = candles.findIndex((c) => c.time === blockTime);
  if (i0 < 0) return false;
  for (let i = i0 + 1; i <= i0 + 3 && i + 1 < candles.length; i++) {
    const a = candles[i - 1]!, c = candles[i + 1]!;
    if (long ? c.low > a.high : c.high < a.low) return true;
  }
  return false;
}

/**
 * Change of character after the block: price closes beyond the most recent
 * opposing swing (3-bar fractal) that formed before the break away from the block.
 * Long: close above a prior swing high. Short: close below a prior swing low.
 */
export function hasChochAfter(candles: ObCandle[], blockTime: number, long: boolean): boolean {
  const i0 = candles.findIndex((c) => c.time === blockTime);
  if (i0 < 2) return false;
  let level: number | null = null;
  for (let i = i0 - 1; i >= 1 && i >= i0 - 30; i--) {
    const p = candles[i - 1]!, c = candles[i]!, n = candles[i + 1]!;
    if (long ? c.high > p.high && c.high > n.high : c.low < p.low && c.low < n.low) {
      level = long ? c.high : c.low; break;
    }
  }
  if (level == null) return false;
  return candles.slice(i0 + 1).some((c) => (long ? c.close > level! : c.close < level!));
}

const MAX_MITIGATIONS = 1;

function onRetestSide(b: OrderBlock, long: boolean, last: number): boolean {
  // Long: block must sit below price (a pullback into it). Short: above price.
  return long ? b.top < last : b.bot > last;
}

export function obEntryShadow(args: {
  bias: "Long" | "Short" | "Neutral";
  lastPrice: number;
  atr: number;
  candles1h?: ObCandle[] | null;
  candles15m?: ObCandle[] | null;
  liveEntry?: number | null;
}): ObEntryShadow | null {
  const { bias, lastPrice: last, atr } = args;
  if (bias === "Neutral" || !(atr > 0) || !(last > 0)) return null;
  const long = bias === "Long";
  const kind = long ? "bullish" : "bearish";

  const h1Blocks = computeOrderBlocks(args.candles1h ?? [], { max: 12 })
    .filter((b) => b.kind === kind && b.mitigations <= MAX_MITIGATIONS && onRetestSide(b, long, last));
  if (!h1Blocks.length) return null;
  // Nearest valid 1H block to price, fresh ones first.
  h1Blocks.sort((a, b) =>
    a.mitigations - b.mitigations ||
    Math.abs(last - (long ? a.top : a.bot)) - Math.abs(last - (long ? b.top : b.bot)),
  );
  const h1 = h1Blocks[0]!;

  // 15m blocks of the same direction that sit inside (overlap) the 1H block.
  const m15Blocks = computeOrderBlocks(args.candles15m ?? [], { max: 20 })
    .filter((b) => b.kind === kind && b.mitigations <= MAX_MITIGATIONS && onRetestSide(b, long, last))
    .filter((b) => b.top <= h1.top + atr * 0.1 && b.bot >= h1.bot - atr * 0.1);
  m15Blocks.sort((a, b) => a.mitigations - b.mitigations || b.time - a.time);
  const m15 = m15Blocks[0] ?? null;

  const zone = m15 ?? h1;
  const entry = long ? zone.top : zone.bot;
  const pad = Math.max(atr * 0.15, last * 0.0002);
  // Stop beyond the far edge of the 1H block: the 15m refines entry, not invalidation.
  const stop = long ? h1.bot - pad : h1.top + pad;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;

  const live = args.liveEntry;
  const shift = live != null && Number.isFinite(live)
    ? +(((long ? live - entry : entry - live) / atr)).toFixed(2)
    : null;
  const source = m15 ? "15m inside 1H" : "1H";
  const base = m15 ? `15m ${kind} order block inside the 1H block` : `1H ${kind} order block`;
  const c1h = args.candles1h ?? [];
  const choch = hasChochAfter(c1h, h1.time, long);
  const fvg = hasAdjacentFvg(c1h, h1.time, long);
  const pass = choch && fvg;
  // Saved label carries the strict tag so results can be split without a new column.
  const label = pass ? `Strict: ${base}` : base;
  return {
    entry,
    stop,
    source,
    label,
    h1: { top: h1.top, bot: h1.bot, time: h1.time },
    m15: m15 ? { top: m15.top, bot: m15.bot, time: m15.time } : null,
    riskAtr: +(risk / atr).toFixed(2),
    entryShiftAtr: shift,
    strict: { choch, fvg, pass },
    note: `Trial only: entry on the retest into the ${label}; the break of structure is confirmation only.`,
  };
}
