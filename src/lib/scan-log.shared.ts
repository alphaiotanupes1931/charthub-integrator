// Rules for the daily scan log: every scan is filed, but only a directional
// call keeps trade levels. A Neutral or NO ENTRY read is stored as "no_trade"
// with its levels cleared, so it can never look like a setup in the review.

export type ScanLogInput = {
  bias: string;
  grade: string;
  entry?: number | null;
  stop?: number | null;
  tp1?: number | null;
  tp2?: number | null;
};

export type NormalizedScanLevels = {
  bias: "Long" | "Short" | "Neutral";
  directional: boolean;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  status: "open" | "no_trade";
};

const finite = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

export function normalizeScanLevels(input: ScanLogInput): NormalizedScanLevels {
  const b = (input.bias ?? "").trim().toLowerCase();
  const bias = b === "long" ? "Long" : b === "short" ? "Short" : "Neutral";
  const entry = finite(input.entry);
  const stop = finite(input.stop);
  const tp1 = finite(input.tp1);
  const directional =
    bias !== "Neutral" && input.grade.trim().toUpperCase() !== "NO ENTRY" && !!entry && !!stop && !!tp1;
  if (!directional) {
    return { bias, directional: false, entry: null, stop: null, tp1: null, tp2: null, status: "no_trade" };
  }
  return { bias, directional: true, entry, stop, tp1, tp2: finite(input.tp2), status: "open" };
}

export type DailyLogScan = {
  created_at: string;
  symbol: string;
  timeframe: string;
  bias: string;
  grade: string;
  data_feed: string | null;
  status: string;
  realized_r: number | null;
  taken: boolean;
  grade_caps?: Array<{ label: string; cap: string }> | null;
};

export type DailyLogSummary = {
  scans: number;
  directional: number;
  settled: number;
  wins: number;
  losses: number;
  totalR: number;
  gradeMix: Record<string, number>;
  feeds: Record<string, number>;
  /** How often each rule held a grade down that day. */
  capCounts: Record<string, number>;
  /** Same symbol + timeframe called both Long and Short on the same day. */
  flips: Array<{ symbol: string; timeframe: string; sequence: string[] }>;
};

/** Plain review summary for one trading day, used by the private daily-log feed. */
export function summarizeDay(rows: DailyLogScan[]): DailyLogSummary {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const gradeMix: Record<string, number> = {};
  const feeds: Record<string, number> = {};
  const capCounts: Record<string, number> = {};
  const seq = new Map<string, string[]>();
  let directional = 0, settled = 0, wins = 0, losses = 0, totalR = 0;
  for (const r of sorted) {
    gradeMix[r.grade] = (gradeMix[r.grade] ?? 0) + 1;
    const f = r.data_feed ?? "unknown";
    feeds[f] = (feeds[f] ?? 0) + 1;
    for (const c of r.grade_caps ?? []) capCounts[c.label] = (capCounts[c.label] ?? 0) + 1;
    if (r.bias === "Long" || r.bias === "Short") {
      directional += 1;
      const k = `${r.symbol}|${r.timeframe}`;
      const list = seq.get(k) ?? [];
      if (list[list.length - 1] !== r.bias) list.push(r.bias);
      seq.set(k, list);
    }
    if (r.realized_r != null) {
      settled += 1;
      totalR += r.realized_r;
      if (r.realized_r > 0) wins += 1;
      else if (r.realized_r < 0) losses += 1;
    }
  }
  const flips = [...seq.entries()]
    .filter(([, s]) => s.length > 1)
    .map(([k, s]) => {
      const [symbol, timeframe] = k.split("|");
      return { symbol, timeframe, sequence: s };
    });
  return {
    scans: rows.length, directional, settled, wins, losses,
    totalR: Math.round(totalR * 100) / 100, gradeMix, feeds, capCounts, flips,
  };
}
