// Volume measurement for the two entry gates (addendum item 3 + 4).
// Pure. Given each resolved signal tagged with whether each gate would have
// kept it, report surviving signals per instrument per week under four
// scenarios, with average R per signal AND total R. The pooled result decides;
// per-split cells under 30 are diagnostic only. How far volume drops is a
// product decision, so this only reports.

export type GateTaggedSignal = {
  symbol: string;
  created_at: string;
  r: number | null;
  /** True when the sweep gate would have let it through (swept or no opposing break). */
  sweepPass: boolean | null;
  /** True when the staleness guard would have let it through. */
  stalePass: boolean | null;
};

export type Scenario = "none" | "sweep" | "stale" | "both";
export const SCENARIOS: Scenario[] = ["none", "sweep", "stale", "both"];
export const SPLIT_FLOOR = 30;

export type ScenarioCell = {
  signals: number;
  avgR: number | null;
  totalR: number;
  perWeek: number;
  enoughData: boolean;
};

export type GateVolumeReport = {
  weeks: number;
  from: string | null;
  to: string | null;
  unmeasured: { sweep: number; stale: number };
  pooled: Record<Scenario, ScenarioCell>;
  bySymbol: Array<{ symbol: string } & Record<Scenario, ScenarioCell>>;
  /** Signals kept per ISO week per instrument, per scenario. */
  weekly: Array<{ week: string; symbol: string } & Record<Scenario, number>>;
  overlap: { removedBySweepOnly: number; removedByStaleOnly: number; removedByBoth: number };
  comparisonsRun: number;
  notes: string[];
};

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

export function keeps(s: GateTaggedSignal, sc: Scenario): boolean {
  // Unmeasurable gate reads are treated as kept, and counted in `unmeasured`.
  const sw = s.sweepPass !== false;
  const st = s.stalePass !== false;
  if (sc === "none") return true;
  if (sc === "sweep") return sw;
  if (sc === "stale") return st;
  return sw && st;
}

export function isoWeek(iso: string): string {
  const d = new Date(iso);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

function cell(rows: GateTaggedSignal[], weeks: number): ScenarioCell {
  const rs = rows.map((r) => r.r).filter((r): r is number => r != null && isFinite(r));
  const total = rs.reduce((a, b) => a + b, 0);
  return {
    signals: rows.length,
    avgR: rs.length ? round(total / rs.length) : null,
    totalR: round(total, 2),
    perWeek: weeks > 0 ? round(rows.length / weeks, 2) : 0,
    enoughData: rows.length >= SPLIT_FLOOR,
  };
}

export function analyzeGateVolume(rows: GateTaggedSignal[]): GateVolumeReport {
  const times = rows.map((r) => r.created_at).sort();
  const from = times[0] ?? null;
  const to = times[times.length - 1] ?? null;
  const weeks = from && to ? Math.max(1, (Date.parse(to) - Date.parse(from)) / (7 * 86400000)) : 0;

  const pooled = Object.fromEntries(SCENARIOS.map((sc) => [sc, cell(rows.filter((r) => keeps(r, sc)), weeks)])) as Record<Scenario, ScenarioCell>;

  const symbols = [...new Set(rows.map((r) => r.symbol))].sort();
  const bySymbol = symbols.map((symbol) => {
    const sub = rows.filter((r) => r.symbol === symbol);
    return { symbol, ...(Object.fromEntries(SCENARIOS.map((sc) => [sc, cell(sub.filter((r) => keeps(r, sc)), weeks)])) as Record<Scenario, ScenarioCell>) };
  });

  const wk = new Map<string, { week: string; symbol: string } & Record<Scenario, number>>();
  for (const r of rows) {
    const week = isoWeek(r.created_at);
    const key = `${week}|${r.symbol}`;
    const e = wk.get(key) ?? { week, symbol: r.symbol, none: 0, sweep: 0, stale: 0, both: 0 };
    for (const sc of SCENARIOS) if (keeps(r, sc)) e[sc] += 1;
    wk.set(key, e);
  }
  const weekly = [...wk.values()].sort((a, b) => (a.week === b.week ? a.symbol.localeCompare(b.symbol) : a.week.localeCompare(b.week)));

  const overlap = { removedBySweepOnly: 0, removedByStaleOnly: 0, removedByBoth: 0 };
  for (const r of rows) {
    const sw = r.sweepPass === false;
    const st = r.stalePass === false;
    if (sw && st) overlap.removedByBoth += 1;
    else if (sw) overlap.removedBySweepOnly += 1;
    else if (st) overlap.removedByStaleOnly += 1;
  }

  const notes = [
    "The pooled result decides whether a gate ships. Per-instrument cells are diagnostic only.",
    `No instrument-level decision below ${SPLIT_FLOOR} resolved signals in the kept set; the global default applies there.`,
    "Compare total R as well as average R: a gate that raises average R while removing most of the total R is a worse product.",
    "Sweep read is reconstructed from closed bars at or before filing time only; HOLD signals that later armed are not replayed here.",
  ];

  return {
    weeks: round(weeks, 1),
    from,
    to,
    unmeasured: { sweep: rows.filter((r) => r.sweepPass == null).length, stale: rows.filter((r) => r.stalePass == null).length },
    pooled,
    bySymbol,
    weekly,
    overlap,
    // 4 scenarios pooled + 4 per instrument: every comparison run is counted.
    comparisonsRun: SCENARIOS.length * (1 + symbols.length),
    notes,
  };
}
