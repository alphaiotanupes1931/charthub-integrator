// Protected low / protected high — quality of a break of structure.
//
// A break of structure on its own means nothing. What matters is the low (for an
// upside break) that produced the high which got broken:
//
//   - If that low itself swept liquidity — it traded below the swing low before
//     it — then the expansion happened AFTER the stops below were taken. The low
//     is PROTECTED: nothing is resting under it, so a long that covers it with
//     the stop and targets the broken high has room to work.
//
//   - If that low never swept anything, untaken liquidity is still sitting
//     below. Price usually goes down to collect it first, which is exactly the
//     break of structure that stops traders out. UNPROTECTED.
//
// Mirrored for a downside break (protected high).
//
// Pure and deterministic: no network, no AI. The AI only narrates what this
// returns.

export type PsCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BosRead = {
  kind: "bullish" | "bearish";
  /** Swing high/low that price closed through. */
  breakLevel: number;
  breakTime: number;
  /** First swing low (bullish) / high (bearish) to the left of the break. */
  originLevel: number;
  originTime: number;
  /** The prior swing this origin had to take out for the break to be trusted. */
  priorLevel: number | null;
  /** Did the origin sweep that prior liquidity before the expansion? */
  swept: boolean;
  sweepTime: number | null;
  /** The origin level when swept — the level a stop should cover. */
  protectedLevel: number | null;
  quality: "protected" | "unprotected";
  /** One plain-English sentence, safe to show to a trader. */
  reason: string;
};

export type ProtectedStructureOptions = {
  /** Fractal wing for swing detection. */
  wing?: number;
  /** How far back to look for the break, in candles. */
  lookback?: number;
};

function swingHighIdx(candles: PsCandle[], wing: number): number[] {
  const out: number[] = [];
  for (let i = wing; i < candles.length - wing; i++) {
    let pivot = true;
    for (let k = 1; k <= wing; k++) {
      if (candles[i - k].high >= candles[i].high || candles[i + k].high >= candles[i].high) { pivot = false; break; }
    }
    if (pivot) out.push(i);
  }
  return out;
}

function swingLowIdx(candles: PsCandle[], wing: number): number[] {
  const out: number[] = [];
  for (let i = wing; i < candles.length - wing; i++) {
    let pivot = true;
    for (let k = 1; k <= wing; k++) {
      if (candles[i - k].low <= candles[i].low || candles[i + k].low <= candles[i].low) { pivot = false; break; }
    }
    if (pivot) out.push(i);
  }
  return out;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const dec = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return n.toFixed(dec);
}

/**
 * Read the most recent break of structure on this series and say whether it left
 * a protected low / high behind. Returns null when there is no readable break.
 */
export function readProtectedStructure(
  candles: PsCandle[],
  opts: ProtectedStructureOptions = {},
): BosRead | null {
  const wing = opts.wing ?? 2;
  const lookback = opts.lookback ?? 120;
  const series = candles.slice(-lookback);
  if (series.length < wing * 4 + 3) return null;

  const highs = swingHighIdx(series, wing);
  const lows = swingLowIdx(series, wing);

  const bull = readOneSide(series, highs, lows, "bullish");
  const bear = readOneSide(series, lows, highs, "bearish");
  if (bull && bear) return bull.breakTime >= bear.breakTime ? bull : bear;
  return bull ?? bear;
}

function readOneSide(
  series: PsCandle[],
  brokenPivots: number[],
  originPivots: number[],
  kind: "bullish" | "bearish",
): BosRead | null {
  const bull = kind === "bullish";
  // Most recent pivot that price has closed through.
  for (let p = brokenPivots.length - 1; p >= 0; p--) {
    const pivotIdx = brokenPivots[p];
    const breakLevel = bull ? series[pivotIdx].high : series[pivotIdx].low;
    let breakIdx = -1;
    for (let i = pivotIdx + 1; i < series.length; i++) {
      if (bull ? series[i].close > breakLevel : series[i].close < breakLevel) { breakIdx = i; break; }
    }
    if (breakIdx < 0) continue;

    // The low (bull) / high (bear) that produced the broken pivot: first opposing
    // swing to the left of it.
    const originIdx = [...originPivots].reverse().find((i) => i < pivotIdx);
    if (originIdx === undefined) continue;
    const originLevel = bull ? series[originIdx].low : series[originIdx].high;

    // The liquidity that origin had to take out: the swing before it.
    const priorIdx = [...originPivots].reverse().find((i) => i < originIdx);
    const priorLevel = priorIdx === undefined ? null : bull ? series[priorIdx].low : series[priorIdx].high;

    let swept = false;
    let sweepTime: number | null = null;
    if (priorIdx !== undefined && priorLevel !== null) {
      // Did anything between the prior swing and the origin trade beyond it?
      for (let i = priorIdx + 1; i <= originIdx; i++) {
        const pierced = bull ? series[i].low <= priorLevel : series[i].high >= priorLevel;
        if (pierced) { swept = true; sweepTime = series[i].time; break; }
      }
    }

    const side = bull ? "low" : "high";
    const dir = bull ? "upside" : "downside";
    const reason = swept
      ? `Good break of structure: price swept the ${side} at ${fmt(priorLevel as number)} before expanding to the ${dir}, so the ${side} at ${fmt(originLevel)} is protected — cover it with the stop and target ${fmt(breakLevel)}.`
      : priorLevel === null
        ? `Break of structure at ${fmt(breakLevel)}, but there is no earlier swing ${side} to check, so the ${side} at ${fmt(originLevel)} cannot be called protected.`
        : `Bad break of structure: the ${side} at ${fmt(originLevel)} expanded to the ${dir} without sweeping the ${side} at ${fmt(priorLevel)} first, so that liquidity is still resting ${bull ? "below" : "above"} and price is likely to take it before the move holds.`;

    return {
      kind,
      breakLevel,
      breakTime: series[breakIdx].time,
      originLevel,
      originTime: series[originIdx].time,
      priorLevel,
      swept,
      sweepTime,
      protectedLevel: swept ? originLevel : null,
      quality: swept ? "protected" : "unprotected",
      reason,
    };
  }
  return null;
}

/** Short label for cards and chart lines. */
export function bosLabel(bos: BosRead): string {
  const side = bos.kind === "bullish" ? "low" : "high";
  return bos.quality === "protected"
    ? `Protected ${side} ${fmt(bos.originLevel)}`
    : `Unprotected ${side} ${fmt(bos.originLevel)}`;
}
