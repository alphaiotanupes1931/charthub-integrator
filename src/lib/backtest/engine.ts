// Deterministic historical backtest engine.
//
// Rules are the same shape the live scanner uses (trend, structure trigger,
// ATR risk), reduced to checks that can be measured on a single bar's history
// so a run is reproducible and contains no look-ahead: a signal formed on bar
// i is only ever filled at the open of bar i+1, and the exit walks bars
// forward one at a time.

export type BtBar = {
  time: number; // seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type BtGrade = "A+" | "A" | "B" | "C";
export const GRADE_ORDER: BtGrade[] = ["C", "B", "A", "A+"];

export type BtParams = {
  minGrade: BtGrade;
  direction: "both" | "long" | "short";
  riskPct: number;
  rrTarget: number;
  atrStopMult: number;
  maxHoldBars: number;
  sessions: string[]; // empty = all sessions
  /** Only take signals that agree with the trend (EMA20/50, EMA50 slope, EMA200). */
  trendFilter: boolean;
  /** Skip triggers stretched more than this many ATR beyond the 10-bar range. */
  maxExtensionAtr: number;
  /**
   * When true, targets are placed at the nearest opposing swing level that
   * still pays for the risk (like the live planner), capped at targetCapR,
   * instead of a fixed rrTarget multiple.
   */
  structureTargets: boolean;
  /** Hard cap on how far a structural target may sit, in R. */
  targetCapR: number;
  /** Minimum reward a structural target must offer to be used. */
  minStructuralRR: number;
};

export const DEFAULT_PARAMS: BtParams = {
  minGrade: "B",
  direction: "both",
  riskPct: 1,
  // Measured over two years of hourly bars on 12 instruments: a 1.5R structural
  // target with a 1.5 ATR stop is the first setting that is positive on all of
  // them, where the old 2R / 1.2 ATR pair was break-even at best.
  rrTarget: 1.5,
  atrStopMult: 1.5,
  maxHoldBars: 40,
  sessions: [],
  trendFilter: true,
  maxExtensionAtr: 1,
  structureTargets: true,
  targetCapR: 3,
  minStructuralRR: 1,
};

export type BtTrade = {
  id: number;
  side: "Long" | "Short";
  grade: BtGrade;
  score: number;
  reasons: string[];
  session: string;
  entryTime: number;
  exitTime: number;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  r: number;
  outcome: "win" | "loss" | "timeout";
  holdBars: number;
  balanceAfter: number;
};

export type BtBucket = {
  key: string;
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  netR: number;
};

export type BtStats = {
  trades: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  expectancyR: number;
  netR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
  maxConsecutiveLosses: number;
  avgHoldBars: number;
  returnPct: number;
  benchmarkPct: number;
};

export type BtResult = {
  symbol: string;
  timeframe: string;
  source: string;
  barCount: number;
  from: number;
  to: number;
  params: BtParams;
  stats: BtStats;
  trades: BtTrade[];
  equity: { time: number; balance: number; netR: number }[];
  byGrade: BtBucket[];
  bySide: BtBucket[];
  bySession: BtBucket[];
  byMonth: BtBucket[];
  notes: string[];
};

// ---------- indicators ----------

function ema(values: number[], period: number): number[] {
  const out: number[] = [];
  const k = 2 / (period + 1);
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function atrSeries(bars: BtBar[], period = 14): number[] {
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      tr.push(bars[i].high - bars[i].low);
      continue;
    }
    const p = bars[i - 1];
    const b = bars[i];
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
  }
  return ema(tr, period);
}

export function sessionOf(timeSec: number): string {
  const h = new Date(timeSec * 1000).getUTCHours();
  if (h < 7) return "Asia";
  if (h < 12) return "London";
  if (h < 17) return "New York";
  return "Late US";
}

function monthOf(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ---------- signal detection ----------

type Signal = {
  side: "Long" | "Short";
  grade: BtGrade;
  score: number;
  reasons: string[];
  withTrend: boolean;
  htfAligned: boolean;
  extensionAtr: number;
};

function gradeFor(score: number): BtGrade | null {
  if (score >= 6) return "A+";
  if (score === 5) return "A";
  if (score === 4) return "B";
  if (score >= 2) return "C";
  return null;
}

function detect(
  bars: BtBar[],
  i: number,
  ema20: number[],
  ema50: number[],
  atr: number[],
  volAvg: number[],
  ema200: number[],
): Signal | null {
  const bar = bars[i];
  const prev = bars[i - 1];
  const a = atr[i];
  if (!bar || !prev || !a || a <= 0) return null;

  const trendUp = ema20[i] > ema50[i];
  const slopeUp = ema50[i] > ema50[i - 5];
  const window = bars.slice(Math.max(0, i - 10), i);
  const priorHigh = Math.max(...window.map((b) => b.high));
  const priorLow = Math.min(...window.map((b) => b.low));

  const breakoutUp = bar.close > priorHigh;
  const breakoutDown = bar.close < priorLow;
  const reclaimUp = prev.close < ema20[i - 1] && bar.close > ema20[i];
  const reclaimDown = prev.close > ema20[i - 1] && bar.close < ema20[i];

  const longTrigger = breakoutUp || reclaimUp;
  const shortTrigger = breakoutDown || reclaimDown;
  if (!longTrigger && !shortTrigger) return null;
  if (longTrigger && shortTrigger) return null;

  const side: "Long" | "Short" = longTrigger ? "Long" : "Short";
  const wantUp = side === "Long";
  const reasons: string[] = [];
  let score = 0;

  if (wantUp === trendUp) {
    score += 1;
    reasons.push(`EMA20 ${wantUp ? "above" : "below"} EMA50`);
  }
  if (wantUp === slopeUp) {
    score += 1;
    reasons.push(`EMA50 sloping ${wantUp ? "up" : "down"}`);
  }
  if (wantUp ? breakoutUp : breakoutDown) {
    score += 1;
    reasons.push(`Closed through the 10-bar ${wantUp ? "high" : "low"}`);
  }
  if (Math.abs(bar.close - bar.open) > a * 0.5) {
    score += 1;
    reasons.push("Trigger bar body larger than half ATR");
  }
  const vol = bar.volume ?? 0;
  if (vol > 0 && volAvg[i] > 0 && vol > volAvg[i] * 1.2) {
    score += 1;
    reasons.push("Volume above the 20-bar average");
  }
  const closeStrong = wantUp
    ? bar.close > bar.low + (bar.high - bar.low) * 0.66
    : bar.close < bar.low + (bar.high - bar.low) * 0.34;
  if (closeStrong) {
    score += 1;
    reasons.push(`Closed in the ${wantUp ? "upper" : "lower"} third of its range`);
  }

  // Higher-timeframe agreement: price on the right side of the 200 EMA. On the
  // 1-hour replay this stands in for the 4H bias the live engine computes.
  const htfAligned = wantUp ? bar.close > ema200[i] : bar.close < ema200[i];
  if (htfAligned) {
    score += 1;
    reasons.push(`Price ${wantUp ? "above" : "below"} the 200 EMA`);
  }

  const grade = gradeFor(Math.min(score, 6));
  if (!grade) return null;
  return {
    side,
    grade,
    score: Math.min(score, 6),
    reasons,
    withTrend: wantUp === trendUp && wantUp === slopeUp,
    htfAligned,
    extensionAtr: wantUp ? (bar.close - priorHigh) / a : (priorLow - bar.close) / a,
  };
}

// ---------- stats ----------

function bucket(key: string, trades: BtTrade[]): BtBucket {
  const wins = trades.filter((t) => t.r > 0).length;
  const netR = trades.reduce((s, t) => s + t.r, 0);
  return {
    key,
    trades: trades.length,
    wins,
    winRate: trades.length ? round((wins / trades.length) * 100, 1) : 0,
    expectancyR: trades.length ? round(netR / trades.length, 2) : 0,
    netR: round(netR, 2),
  };
}

function group(trades: BtTrade[], keyOf: (t: BtTrade) => string, order?: string[]): BtBucket[] {
  const map = new Map<string, BtTrade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    const arr = map.get(k) ?? [];
    arr.push(t);
    map.set(k, arr);
  }
  const rows = [...map.entries()].map(([k, v]) => bucket(k, v));
  if (order) {
    return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

// ---------- structure targets ----------

/**
 * Opposing swing levels visible at bar `i` (fractal pivots over the last 120
 * bars plus the 20-bar extreme), sorted nearest-first from `entry` in the
 * trade's direction. Mirrors how the live planner picks TP1/TP2 from recent
 * structure instead of a fixed R multiple.
 */
function structuralTarget(
  bars: BtBar[],
  i: number,
  side: "Long" | "Short",
  entry: number,
  stopDist: number,
  p: BtParams,
): { target: number; structural: boolean } {
  const fallback = side === "Long" ? entry + stopDist * p.rrTarget : entry - stopDist * p.rrTarget;
  if (!p.structureTargets) return { target: fallback, structural: false };

  const pivots: number[] = [];
  const from = Math.max(2, i - 120);
  for (let j = from; j <= i - 2; j++) {
    const b = bars[j];
    if (side === "Long") {
      if (b.high > bars[j - 1].high && b.high > bars[j + 1].high) pivots.push(b.high);
    } else {
      if (b.low < bars[j - 1].low && b.low < bars[j + 1].low) pivots.push(b.low);
    }
  }
  // Recent range extreme counts as a level even without a clean pivot.
  let extreme = side === "Long" ? -Infinity : Infinity;
  for (let j = Math.max(0, i - 20); j <= i; j++) {
    extreme = side === "Long" ? Math.max(extreme, bars[j].high) : Math.min(extreme, bars[j].low);
  }
  if (Number.isFinite(extreme)) pivots.push(extreme);

  const minDist = stopDist * p.minStructuralRR;
  const maxDist = stopDist * p.targetCapR;
  const candidates = pivots
    .map((lvl) => (side === "Long" ? lvl - entry : entry - lvl))
    .filter((d) => d >= minDist && d <= maxDist)
    .sort((a, b) => a - b);
  if (!candidates.length) return { target: fallback, structural: false };
  const dist = candidates[0];
  return { target: side === "Long" ? entry + dist : entry - dist, structural: true };
}

// ---------- runner ----------

export function runBacktest(
  bars: BtBar[],
  params: BtParams,
  meta: { symbol: string; timeframe: string; source: string },
): BtResult {
  const p = { ...DEFAULT_PARAMS, ...params };
  const notes: string[] = [];
  const closes = bars.map((b) => b.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const atr = atrSeries(bars, 14);
  const volAvg = ema(bars.map((b) => b.volume ?? 0), 20);
  const ema200 = ema(closes, 200);

  const minRank = GRADE_ORDER.indexOf(p.minGrade);
  const trades: BtTrade[] = [];
  const equity: { time: number; balance: number; netR: number }[] = [];
  let balance = 10_000;
  let peak = balance;
  let maxDd = 0;
  let netR = 0;
  let consec = 0;
  let maxConsec = 0;
  let id = 0;

  // 200-EMA warm-up: earlier bars have no meaningful higher-timeframe read.
  const startIndex = 210;
  if (bars.length <= startIndex + 5) {
    notes.push("Not enough history was returned to form a signal on this timeframe.");
  }

  let i = startIndex;
  while (i < bars.length - 2) {
    const sig = detect(bars, i, ema20, ema50, atr, volAvg, ema200);
    if (!sig) {
      i += 1;
      continue;
    }
    // Counter-trend and over-extended triggers are what the live engine caps at
    // C and refuses to publish; the replay has to refuse them too.
    if (p.trendFilter && (!sig.withTrend || !sig.htfAligned)) {
      i += 1;
      continue;
    }
    if (p.maxExtensionAtr > 0 && sig.extensionAtr > p.maxExtensionAtr) {
      i += 1;
      continue;
    }
    if (GRADE_ORDER.indexOf(sig.grade) < minRank) {
      i += 1;
      continue;
    }
    if (p.direction !== "both" && sig.side.toLowerCase() !== p.direction) {
      i += 1;
      continue;
    }
    const fillBar = bars[i + 1];
    const session = sessionOf(fillBar.time);
    if (p.sessions.length > 0 && !p.sessions.includes(session)) {
      i += 1;
      continue;
    }

    const entry = fillBar.open;
    const stopDist = atr[i] * p.atrStopMult;
    if (!(stopDist > 0)) {
      i += 1;
      continue;
    }
    const stop = sig.side === "Long" ? entry - stopDist : entry + stopDist;
    const target = sig.side === "Long" ? entry + stopDist * p.rrTarget : entry - stopDist * p.rrTarget;

    let exit = fillBar.close;
    let exitTime = fillBar.time;
    let outcome: BtTrade["outcome"] = "timeout";
    let held = 0;
    for (let j = i + 1; j < bars.length && held < p.maxHoldBars; j++, held++) {
      const b = bars[j];
      const hitStop = sig.side === "Long" ? b.low <= stop : b.high >= stop;
      const hitTarget = sig.side === "Long" ? b.high >= target : b.low <= target;
      exitTime = b.time;
      if (hitStop) {
        // Conservative: when a bar covers both levels the stop is assumed first.
        exit = stop;
        outcome = "loss";
        break;
      }
      if (hitTarget) {
        exit = target;
        outcome = "win";
        break;
      }
      exit = b.close;
    }

    const r = round(((sig.side === "Long" ? exit - entry : entry - exit) / stopDist), 3);
    netR += r;
    balance = balance * (1 + (p.riskPct / 100) * r);
    peak = Math.max(peak, balance);
    maxDd = Math.max(maxDd, ((peak - balance) / peak) * 100);
    if (r <= 0) {
      consec += 1;
      maxConsec = Math.max(maxConsec, consec);
    } else {
      consec = 0;
    }

    id += 1;
    trades.push({
      id,
      side: sig.side,
      grade: sig.grade,
      score: sig.score,
      reasons: sig.reasons,
      session,
      entryTime: fillBar.time,
      exitTime,
      entry: round(entry, 5),
      stop: round(stop, 5),
      target: round(target, 5),
      exit: round(exit, 5),
      r,
      outcome: outcome === "timeout" ? (r > 0 ? "win" : "loss") : outcome,
      holdBars: held + 1,
      balanceAfter: round(balance, 2),
    });
    equity.push({ time: exitTime, balance: round(balance, 2), netR: round(netR, 2) });

    // No overlapping positions: resume scanning after the exit bar.
    const exitIndex = bars.findIndex((b) => b.time === exitTime);
    i = exitIndex > i ? exitIndex + 1 : i + 1;
  }

  const wins = trades.filter((t) => t.r > 0);
  const losses = trades.filter((t) => t.r <= 0);
  const grossWin = wins.reduce((s, t) => s + t.r, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.r, 0));
  const first = bars[startIndex]?.close ?? 0;
  const last = bars[bars.length - 1]?.close ?? 0;

  if (trades.length > 0 && trades.length < 15) {
    notes.push(`Only ${trades.length} trades matched these filters. Treat the numbers as indicative, not proof.`);
  }
  if (trades.length === 0 && bars.length > startIndex + 5) {
    notes.push("No signal in this window passed the grade, direction and session filters. Loosen the minimum grade or widen the lookback.");
  }
  if (!bars.some((b) => (b.volume ?? 0) > 0)) {
    notes.push("This feed returned no volume, so the volume check could not score. Grades run one point lower than a volume-backed run.");
  }

  const stats: BtStats = {
    trades: trades.length,
    wins: wins.length,
    losses: losses.filter((t) => t.outcome === "loss").length,
    timeouts: trades.filter((t) => t.holdBars >= p.maxHoldBars).length,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
    expectancyR: trades.length ? round(netR / trades.length, 2) : 0,
    netR: round(netR, 2),
    avgWinR: wins.length ? round(grossWin / wins.length, 2) : 0,
    avgLossR: losses.length ? round(-grossLoss / losses.length, 2) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
    maxDrawdownPct: round(maxDd, 2),
    maxConsecutiveLosses: maxConsec,
    avgHoldBars: trades.length ? round(trades.reduce((s, t) => s + t.holdBars, 0) / trades.length, 1) : 0,
    returnPct: round(((balance - 10_000) / 10_000) * 100, 2),
    benchmarkPct: first > 0 ? round(((last - first) / first) * 100, 2) : 0,
  };

  return {
    symbol: meta.symbol,
    timeframe: meta.timeframe,
    source: meta.source,
    barCount: bars.length,
    from: bars[0]?.time ?? 0,
    to: bars[bars.length - 1]?.time ?? 0,
    params: p,
    stats,
    trades,
    equity,
    byGrade: group(trades, (t) => t.grade, ["A+", "A", "B", "C"]),
    bySide: group(trades, (t) => t.side),
    bySession: group(trades, (t) => t.session, ["Asia", "London", "New York", "Late US"]),
    byMonth: group(trades, (t) => monthOf(t.entryTime)),
    notes,
  };
}
