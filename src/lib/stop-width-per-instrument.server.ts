// Per-instrument stop-width sweep.
//
// `stop-width-test.server.ts` answers one question: does a single common stop
// width change grade ordering? It pools every market together, which is exactly
// what the earlier calibration work said not to do - gold, USD/JPY and NAS100 do
// not breathe at the same scale relative to their own ATR.
//
// This sweeps several stop multiples per symbol, holding entry, direction and
// planned R:R fixed, and reports which multiple would have paid best for that
// symbol alone. It is read-only research: nothing is written back and no live
// stop placement changes off the back of it. Results below the sample floor are
// reported with `enoughData: false` so a lucky handful of trades never becomes a
// production constant.

import { replayForward, replayDirection, type ReplayBar } from "@/lib/signal-replay";
import { costInR } from "@/lib/trading-costs";
import { PLANNER_STOP_MULT } from "@/lib/stop-width-test.server";

/** Candle loader, injected so tests do not reach for market data. */
export type BarLoader = (symbol: string, timeframe: string) => Promise<ReplayBar[]>;

const HISTORY_TF: Record<string, "15" | "60" | "240" | "D"> = {
  "1": "15", "5": "15", "15": "15", "30": "60", "60": "60", "240": "240", D: "D", W: "D",
};

/**
 * One history fetch per (symbol, timeframe) for the whole sweep. Re-resolving
 * each signal at six stop widths through `resolveSignal` meant six fetches per
 * signal and the run never finished; the bars are identical every time, so they
 * are loaded once and walked in memory.
 */
export function cachedBarLoader(): BarLoader {
  const cache = new Map<string, Promise<ReplayBar[]>>();
  return (symbol, timeframe) => {
    const tf = HISTORY_TF[timeframe] ?? "60";
    const key = `${symbol}:${tf}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = (async () => {
        try {
          const { getHistory } = await import("@/lib/backtest/history.server");
          const res = await getHistory(symbol, tf, "1y");
          return res.bars as ReplayBar[];
        } catch {
          return [];
        }
      })();
      cache.set(key, hit);
    }
    return hit;
  };
}


/** Below this, per-symbol differences are noise, not evidence. */
export const PER_INSTRUMENT_SAMPLE_FLOOR = 30;

/** Stop multiples swept by default, in ATR at scan time. */
export const DEFAULT_STOP_MULTIPLES = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

export type FiledSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  grade: string;
  bias: string;
  entry: number;
  stop: number;
  tp1: number;
  status: string;
  realizedR: number | null;
  created_at: string;
};

export type StopMultipleResult = {
  mult: number;
  decided: number;
  targets: number;
  stops: number;
  hitRate: number | null;
  expectancyR: number | null;
  netExpectancyR: number | null;
  avgCostR: number | null;
};

export type InstrumentStopWidthRow = {
  symbol: string;
  trades: number;
  /** As filed, at the planner's grade-dependent stop. */
  filedHitRate: number | null;
  filedNetExpectancyR: number | null;
  sweep: StopMultipleResult[];
  /** Best net expectancy in the sweep, or null when nothing resolved. */
  bestMult: number | null;
  bestNetExpectancyR: number | null;
  /** True only when `trades` clears the sample floor. */
  enoughData: boolean;
  /** Plain-language read of this row, safe to quote. */
  note: string;
};

export type PerInstrumentStopWidthReport = {
  multiples: number[];
  sampleFloor: number;
  rows: InstrumentStopWidthRow[];
  skipped: number;
  notes: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const avg = (xs: number[]): number | null =>
  xs.length ? round2(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
const rate = (wins: number, losses: number): number | null =>
  wins + losses ? Math.round((wins / (wins + losses)) * 1000) / 10 : null;

/**
 * Re-resolve every filed signal at each stop multiple, grouped by symbol.
 *
 * TP1 always moves out in the same proportion as the stop, so planned R:R is
 * held constant and the only variable is how much room the trade was given.
 * Widening the stop with TP1 pinned would change two things at once and the
 * result would not be readable.
 */
export async function runPerInstrumentStopWidthSweep(
  rows: FiledSignal[],
  multiples: number[] = DEFAULT_STOP_MULTIPLES,
  opts: { sampleFloor?: number } = {},
): Promise<PerInstrumentStopWidthReport> {
  const sampleFloor = opts.sampleFloor ?? PER_INSTRUMENT_SAMPLE_FLOOR;
  const mults = [...new Set(multiples.filter((m) => Number.isFinite(m) && m > 0))].sort((a, b) => a - b);
  let skipped = 0;

  type Bucket = {
    filed: FiledSignal[];
    perMult: Map<number, Array<{ r: number | null; hit: boolean | null; costR: number }>>;
  };
  const bySymbol = new Map<string, Bucket>();

  for (const row of rows) {
    const direction = signalDirection(row.bias);
    const filedMult = PLANNER_STOP_MULT[row.grade];
    const risk = Math.abs(row.entry - row.stop);
    if (!direction || !filedMult || !(risk > 0)) {
      skipped += 1;
      continue;
    }
    // Stop distance was atr * filedMult, so ATR at scan time is recoverable.
    const atr = risk / filedMult;
    const bucket: Bucket = bySymbol.get(row.symbol) ?? { filed: [], perMult: new Map() };
    bucket.filed.push(row);

    for (const mult of mults) {
      const widened = atr * mult;
      const stop = direction === "long" ? row.entry - widened : row.entry + widened;
      const scale = widened / risk;
      const tp1 = row.entry + (row.tp1 - row.entry) * scale;
      const sig: OpenSignal = {
        id: row.id,
        symbol: row.symbol,
        timeframe: row.timeframe,
        bias: row.bias,
        entry: row.entry,
        stop,
        tp1,
        created_at: row.created_at,
      };
      const res = await resolveSignal(sig);
      const list = bucket.perMult.get(mult) ?? [];
      list.push({
        r: res.realizedR,
        hit: res.status === "target" ? true : res.status === "stop" ? false : null,
        costR: costInR(row.symbol, row.entry, widened),
      });
      bucket.perMult.set(mult, list);
    }
    bySymbol.set(row.symbol, bucket);
  }

  const out: InstrumentStopWidthRow[] = [...bySymbol.entries()].map(([symbol, b]) => {
    const filedWins = b.filed.filter((r) => r.status === "target").length;
    const filedLosses = b.filed.filter((r) => r.status === "stop").length;
    const filedR = b.filed.map((r) => r.realizedR).filter((r): r is number => r != null);
    const filedCost = avg(b.filed.map((r) => costInR(r.symbol, r.entry, Math.abs(r.entry - r.stop))));
    const filedExp = avg(filedR);

    const sweep: StopMultipleResult[] = mults.map((mult) => {
      const list = b.perMult.get(mult) ?? [];
      const targets = list.filter((x) => x.hit === true).length;
      const stops = list.filter((x) => x.hit === false).length;
      const rs = list.map((x) => x.r).filter((r): r is number => r != null);
      const exp = avg(rs);
      const cost = avg(list.map((x) => x.costR));
      return {
        mult,
        decided: targets + stops,
        targets,
        stops,
        hitRate: rate(targets, stops),
        expectancyR: exp,
        netExpectancyR: exp == null || cost == null ? null : round2(exp - cost),
        avgCostR: cost,
      };
    });

    const ranked = sweep
      .filter((s) => s.netExpectancyR != null && s.decided > 0)
      .sort((a, b2) => (b2.netExpectancyR as number) - (a.netExpectancyR as number));
    const best = ranked[0] ?? null;
    const enoughData = b.filed.length >= sampleFloor;

    const note = !best
      ? "Nothing resolved at any stop width, so this market says nothing yet."
      : !enoughData
        ? `Only ${b.filed.length} resolved trades - under the ${sampleFloor}-trade floor, so treat the best width as a hint, not a setting.`
        : `${b.filed.length} resolved trades. Best net result at ${best.mult}x ATR (${best.netExpectancyR}R after costs).`;

    return {
      symbol,
      trades: b.filed.length,
      filedHitRate: rate(filedWins, filedLosses),
      filedNetExpectancyR: filedExp == null || filedCost == null ? null : round2(filedExp - filedCost),
      sweep,
      bestMult: best ? best.mult : null,
      bestNetExpectancyR: best ? best.netExpectancyR : null,
      enoughData,
      note,
    };
  });

  out.sort((a, b) => b.trades - a.trades || a.symbol.localeCompare(b.symbol));

  const notes = [
    "TP1 moves out in the same proportion as the stop, so planned R:R is constant and the only variable is stop room.",
    `Rows with fewer than ${sampleFloor} resolved trades are marked enoughData: false and must not become production stop constants.`,
    "Read-only: no live stop placement, grade or rulebook changes come from this report.",
  ];
  if (skipped > 0) {
    notes.push(`${skipped} rows skipped: no direction, unknown grade or zero risk distance.`);
  }

  return { multiples: mults, sampleFloor, rows: out, skipped, notes };
}
