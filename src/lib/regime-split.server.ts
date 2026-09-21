/**
 * Regime split on our own signal history.
 *
 * The regime-router document claims instrument performance is explained by the
 * regime the market was in when the setup was taken. Before any router is allowed
 * to gate live signals, that claim has to survive our own record: tag every
 * decided signal with the regime present at emission time, then split outcomes by
 * regime and report sample size next to every number.
 *
 * Deliberate limits, stated rather than hidden:
 *  - The regime is reconstructed from closed bars at or before the filing time.
 *    No bar after the signal is read, so there is no look-ahead.
 *  - Volume and order-book depth are not in the stored history, so the
 *    reconstruction uses the price-only subset of `MarketConditions`. That means
 *    "breakout-expansion" (which needs rising volume) cannot be reconstructed and
 *    will not appear. This is a narrower classifier than the live one, on purpose.
 *  - Nothing is written back and no live behaviour changes off this report.
 */

import { classifyRegime, type MarketRegime, type MarketConditions } from "@/lib/strategyAuto";
import { wilson95, SAMPLE_FLOOR, twoProportionP } from "@/lib/statistics";
import type { ReplayBar } from "@/lib/signal-replay";

export type RegimeSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  grade: string;
  bias: string;
  status: string;
  /** Net of costs where present, gross otherwise. */
  r: number | null;
  created_at: string;
};

export type TaggedSignal = RegimeSignal & { regime: MarketRegime | null };

export type RegimeCell = {
  regime: MarketRegime | "unclassified";
  decided: number;
  targets: number;
  stops: number;
  hitRate: number | null;
  hitRate95: { low: number; high: number } | null;
  avgR: number | null;
  enoughData: boolean;
};

export type RegimeSplitReport = {
  tagged: number;
  untagged: number;
  overall: RegimeCell;
  byRegime: RegimeCell[];
  bySymbol: { symbol: string; cells: RegimeCell[] }[];
  aGradeByRegime: RegimeCell[];
  /** Best vs worst regime, only when both clear the sample floor. */
  spread: { best: string; worst: string; avgRGap: number; hitRateP: number | null } | null;
  verdict: string;
  notes: string[];
};

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

function atr(bars: ReplayBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  let sum = 0;
  for (let i = bars.length - period; i < bars.length; i++) {
    const b = bars[i]!;
    const prev = bars[i - 1]!;
    sum += Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close));
  }
  return sum / period;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return e;
}

/** Closed bars at or before the filing time - never after. */
export function barsBefore(bars: ReplayBar[], createdAtIso: string): ReplayBar[] {
  const t = Math.floor(new Date(createdAtIso).getTime() / 1000);
  if (!Number.isFinite(t)) return [];
  return bars.filter((b) => b.time <= t);
}

/**
 * Price-only reconstruction of the conditions the live picker sees. Volume and
 * depth are neutral because the history does not carry them.
 */
export function conditionsAtEmission(
  bars: ReplayBar[],
  createdAtIso: string,
  interval: string,
): MarketConditions | null {
  const hist = barsBefore(bars, createdAtIso);
  if (hist.length < 60) return null;
  const closes = hist.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  const a = atr(hist);
  if (fast == null || slow == null || a == null || !(last > 0)) return null;

  const window = hist.slice(-20);
  const hi = Math.max(...window.map((b) => b.high));
  const lo = Math.min(...window.map((b) => b.low));
  const rangePct = ((hi - lo) / last) * 100;
  const sep = ((fast - slow) / last) * 100;
  // A trend is only called when the moving averages are meaningfully apart.
  const trend: MarketConditions["trend"] = sep > 0.1 ? "up" : sep < -0.1 ? "down" : "range";
  const near = (hi - lo) * 0.15;
  const atRangeEdge = last >= hi - near || last <= lo + near;
  const alignment: MarketConditions["alignment"] =
    trend === "up" && last > fast ? "aligned-long"
    : trend === "down" && last < fast ? "aligned-short"
    : trend === "range" ? "none"
    : "mixed";

  return {
    interval,
    trend,
    alignment,
    cisd: "none",
    atrPct: (a / last) * 100,
    rangePct,
    atRangeEdge,
    // Neutral: not stored, so it must not be allowed to invent a regime.
    volRatio: 1,
    depth: "normal",
    market: "Forex",
    sessionOpen: true,
  };
}

export function regimeAtEmission(
  bars: ReplayBar[],
  createdAtIso: string,
  interval: string,
): MarketRegime | null {
  const c = conditionsAtEmission(bars, createdAtIso, interval);
  return c ? classifyRegime(c) : null;
}

function cell(label: RegimeCell["regime"], rows: TaggedSignal[]): RegimeCell {
  const decidedRows = rows.filter((r) => r.status === "target" || r.status === "stop");
  const targets = decidedRows.filter((r) => r.status === "target").length;
  const stops = decidedRows.length - targets;
  const rs = decidedRows.map((r) => r.r).filter((v): v is number => v != null);
  return {
    regime: label,
    decided: decidedRows.length,
    targets,
    stops,
    hitRate: decidedRows.length ? round((targets / decidedRows.length) * 100, 1) : null,
    hitRate95: wilson95(targets, decidedRows.length),
    avgR: rs.length ? round(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
    enoughData: decidedRows.length >= SAMPLE_FLOOR,
  };
}

export function analyzeRegimeSplit(rows: TaggedSignal[]): RegimeSplitReport {
  const tagged = rows.filter((r) => r.regime != null);
  const untagged = rows.length - tagged.length;

  const regimes = Array.from(new Set(tagged.map((r) => r.regime!)));
  const byRegime = regimes
    .map((g) => cell(g, tagged.filter((r) => r.regime === g)))
    .sort((a, b) => b.decided - a.decided);

  const symbols = Array.from(new Set(tagged.map((r) => r.symbol)));
  const bySymbol = symbols
    .map((symbol) => {
      const own = tagged.filter((r) => r.symbol === symbol);
      return {
        symbol,
        cells: Array.from(new Set(own.map((r) => r.regime!)))
          .map((g) => cell(g, own.filter((r) => r.regime === g)))
          .sort((a, b) => b.decided - a.decided),
      };
    })
    .sort((a, b) => {
      const an = a.cells.reduce((s, c) => s + c.decided, 0);
      const bn = b.cells.reduce((s, c) => s + c.decided, 0);
      return bn - an;
    });

  const aRows = tagged.filter((r) => r.grade.trim().toUpperCase().startsWith("A"));
  const aGradeByRegime = Array.from(new Set(aRows.map((r) => r.regime!)))
    .map((g) => cell(g, aRows.filter((r) => r.regime === g)))
    .sort((a, b) => b.decided - a.decided);

  const powered = byRegime.filter((c) => c.enoughData && c.avgR != null);
  let spread: RegimeSplitReport["spread"] = null;
  if (powered.length >= 2) {
    const sorted = [...powered].sort((a, b) => (b.avgR ?? 0) - (a.avgR ?? 0));
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    spread = {
      best: String(best.regime),
      worst: String(worst.regime),
      avgRGap: round((best.avgR ?? 0) - (worst.avgR ?? 0)),
      hitRateP: twoProportionP(best.targets, best.decided, worst.targets, worst.decided),
    };
  }

  const notes: string[] = [
    "Regime reconstructed from closed bars at or before filing time; no look-ahead.",
    "Volume and depth are not stored, so breakout-expansion cannot be reconstructed and will not appear.",
    `Cells under ${SAMPLE_FLOOR} decided trades are reported, not claimed.`,
  ];
  if (untagged) notes.push(`${untagged} signals could not be tagged (missing or short history).`);

  let verdict: string;
  if (!spread) {
    verdict =
      "Not enough decided trades in at least two regimes to compare. Regime gating stays off.";
  } else if (Math.abs(spread.avgRGap) < 0.1 || (spread.hitRateP ?? 1) > 0.05) {
    verdict = `No reliable regime effect: ${spread.best} vs ${spread.worst} differ by ${spread.avgRGap}R with p=${spread.hitRateP == null ? "n/a" : round(spread.hitRateP)}. Regime gating stays off.`;
  } else {
    verdict = `${spread.best} outperformed ${spread.worst} by ${spread.avgRGap}R (p=${round(spread.hitRateP ?? 1)}). Worth a shadow trial before any live gate.`;
  }

  return {
    tagged: tagged.length,
    untagged,
    overall: cell("unclassified", tagged),
    byRegime,
    bySymbol,
    aGradeByRegime,
    spread,
    verdict,
    notes,
  };
}
