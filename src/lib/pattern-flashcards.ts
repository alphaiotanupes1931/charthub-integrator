export type Bias = "bullish" | "bearish" | "neutral";
export type Bar = { o: number; h: number; l: number; c: number };
export type PatternCard = {
  id: string;
  name: string;
  kind: "candle" | "chart";
  bias: Bias;
  /** One or two short sentences. */
  why: string;
  bars: Bar[];
  /** Index range of the bars that form the pattern. */
  highlight: [number, number];
};

const bar = (o: number, h: number, l: number, c: number): Bar => ({ o, h, l, c });

/** Turn a list of closes into simple candles. */
function path(closes: number[], wick = 0.4): Bar[] {
  const out: Bar[] = [];
  for (let i = 1; i < closes.length; i++) {
    const o = closes[i - 1], c = closes[i];
    out.push(bar(o, Math.max(o, c) + wick, Math.min(o, c) - wick, c));
  }
  return out;
}
const down = (from: number, n: number, step = 1.2) => Array.from({ length: n }, (_, i) => from - i * step);
const up = (from: number, n: number, step = 1.2) => Array.from({ length: n }, (_, i) => from + i * step);

export const PATTERN_CARDS: PatternCard[] = [
  { id: "hammer", name: "Hammer", kind: "candle", bias: "bullish",
    why: "Sellers pushed price far down, buyers pushed it back up. The long lower wick after a drop shows buyers stepping in.",
    bars: [...path(down(110, 6)), bar(104, 104.6, 100, 104.4)], highlight: [5, 5] },
  { id: "shooting_star", name: "Shooting star", kind: "candle", bias: "bearish",
    why: "Buyers pushed price high, sellers slammed it back down. The long upper wick after a rise shows selling pressure.",
    bars: [...path(up(100, 6)), bar(106, 110, 105.6, 105.8)], highlight: [5, 5] },
  { id: "bull_engulf", name: "Bullish engulfing", kind: "candle", bias: "bullish",
    why: "A big green candle swallows the red one before it. Buyers took full control after a drop.",
    bars: [...path(down(110, 6)), bar(104.2, 104.4, 103, 103.2), bar(103, 105.6, 102.8, 105.4)], highlight: [5, 6] },
  { id: "bear_engulf", name: "Bearish engulfing", kind: "candle", bias: "bearish",
    why: "A big red candle swallows the green one before it. Sellers took full control after a rise.",
    bars: [...path(up(100, 6)), bar(105.8, 107, 105.6, 106.8), bar(107, 107.2, 104.4, 104.6)], highlight: [5, 6] },
  { id: "doji", name: "Doji", kind: "candle", bias: "neutral",
    why: "Open and close are almost the same. Buyers and sellers are undecided, so wait for the next candle.",
    bars: [...path([100, 101, 100.4, 101.2, 100.6, 101]), bar(101, 102.4, 99.6, 101.05)], highlight: [5, 5] },
  { id: "morning_star", name: "Morning star", kind: "candle", bias: "bullish",
    why: "Three candles: a big red, a small pause, then a big green. The drop ran out of steam and buyers took over.",
    bars: [...path(down(110, 5)), bar(105, 105.2, 101.8, 102), bar(101.8, 102.2, 101.2, 101.6), bar(101.8, 104.8, 101.6, 104.6)], highlight: [4, 6] },
  { id: "evening_star", name: "Evening star", kind: "candle", bias: "bearish",
    why: "Three candles: a big green, a small pause, then a big red. The rise ran out of steam and sellers took over.",
    bars: [...path(up(100, 5)), bar(105, 108, 104.8, 107.8), bar(108, 108.8, 107.8, 108.4), bar(108.2, 108.4, 105, 105.2)], highlight: [4, 6] },
  { id: "three_soldiers", name: "Three white soldiers", kind: "candle", bias: "bullish",
    why: "Three strong green candles in a row, each closing higher. Steady buying pressure.",
    bars: [...path([104, 103.4, 103.8, 103, 103.4]), bar(103.4, 105.2, 103.2, 105), bar(105, 106.8, 104.8, 106.6), bar(106.6, 108.4, 106.4, 108.2)], highlight: [4, 6] },
  { id: "three_crows", name: "Three black crows", kind: "candle", bias: "bearish",
    why: "Three strong red candles in a row, each closing lower. Steady selling pressure.",
    bars: [...path([104, 104.6, 104.2, 105, 104.6]), bar(104.6, 104.8, 102.8, 103), bar(103, 103.2, 101.2, 101.4), bar(101.4, 101.6, 99.6, 99.8)], highlight: [4, 6] },
  { id: "bull_flag", name: "Bull flag", kind: "chart", bias: "bullish",
    why: "A sharp rise (the pole), then a small drift down (the flag). Usually breaks up and continues.",
    bars: path([100, 100.4, 103, 106, 109, 108.4, 108.8, 108, 108.3, 107.6, 108, 110.5]), highlight: [1, 10] },
  { id: "bear_flag", name: "Bear flag", kind: "chart", bias: "bearish",
    why: "A sharp drop (the pole), then a small drift up (the flag). Usually breaks down and continues.",
    bars: path([110, 109.6, 107, 104, 101, 101.6, 101.2, 102, 101.7, 102.4, 102, 99.5]), highlight: [1, 10] },
  { id: "double_top", name: "Double top", kind: "chart", bias: "bearish",
    why: "Price hits the same high twice and fails. Looks like an M. A break below the middle low points down.",
    bars: path([100, 103, 106, 108.5, 106, 104, 106, 108.4, 106, 103.5, 101]), highlight: [2, 9] },
  { id: "double_bottom", name: "Double bottom", kind: "chart", bias: "bullish",
    why: "Price hits the same low twice and holds. Looks like a W. A break above the middle high points up.",
    bars: path([110, 107, 104, 101.5, 104, 106, 104, 101.6, 104, 106.5, 109]), highlight: [2, 9] },
  { id: "hs", name: "Head and shoulders", kind: "chart", bias: "bearish",
    why: "Three peaks, the middle one highest. When price breaks the neckline under them, the uptrend is usually over.",
    bars: path([100, 103, 105.5, 103, 102, 105, 108.5, 105, 102, 104.5, 105.4, 102.5, 99.5]), highlight: [1, 11] },
  { id: "ihs", name: "Inverse head and shoulders", kind: "chart", bias: "bullish",
    why: "Three dips, the middle one lowest. When price breaks the neckline above them, the downtrend is usually over.",
    bars: path([110, 107, 104.5, 107, 108, 105, 101.5, 105, 108, 105.5, 104.6, 107.5, 110.5]), highlight: [1, 11] },
];

/** Four short name choices including the right one, deterministic per seed. */
export function nameChoices(card: PatternCard, seed: number): string[] {
  const others = PATTERN_CARDS.filter((c) => c.id !== card.id && c.kind === card.kind).map((c) => c.name);
  const pickN: string[] = [];
  let s = Math.abs(Math.floor(seed)) + 1;
  while (pickN.length < 3 && others.length) {
    s = (s * 9301 + 49297) % 233280;
    pickN.push(others.splice(s % others.length, 1)[0]);
  }
  const all = [...pickN];
  all.splice(s % (all.length + 1), 0, card.name);
  return all;
}

/**
 * Next card for this trader: never repeats until every card has been shown,
 * and cards answered wrong come back first.
 */
export function nextCard(seen: string[], missed: string[], seed: number): PatternCard {
  const retry = PATTERN_CARDS.find((c) => missed.includes(c.id) && seen[seen.length - 1] !== c.id);
  if (retry) return retry;
  let pool = PATTERN_CARDS.filter((c) => !seen.includes(c.id));
  if (!pool.length) pool = PATTERN_CARDS.filter((c) => c.id !== seen[seen.length - 1]);
  return pool[Math.abs(Math.floor(seed)) % pool.length];
}

/** Update seen/missed after an answer. Resets the cycle once every card is seen. */
export function recordAnswer(seen: string[], missed: string[], id: string, correct: boolean) {
  let nextSeen = [...seen.filter((x) => x !== id), id];
  if (PATTERN_CARDS.every((c) => nextSeen.includes(c.id))) nextSeen = [id];
  const nextMissed = correct ? missed.filter((x) => x !== id) : Array.from(new Set([...missed, id]));
  return { seen: nextSeen, missed: nextMissed };
}
