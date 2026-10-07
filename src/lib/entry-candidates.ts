// Entry framework v2. The break of structure only advances a state machine; it
// never produces a price. From one confirmed break we compute four candidate
// entries and record all of them. Which one trades is decided per instrument by
// measurement (see ENTRY_MODEL_V2_LIVE), never by default.
//
// Fair test: every candidate uses the SAME risk distance and the SAME target,
// so a tighter inner level cannot flatter its quoted R:R. A candidate that never
// fills scores 0R and stays in the sample.

import { computeOrderBlocks, type ObCandle } from "@/lib/orderBlocks";
import { findSweepAndBreak } from "@/lib/sequence-entry-shadow";

export const ENTRY_FRAMEWORK_VERSION = "entry-framework-2.0-shadow";

export type EntryModel = "order_block" | "imbalance" | "broken_level" | "retracement_618_79" | "legacy";
export const CANDIDATE_MODELS = ["order_block", "imbalance", "broken_level", "retracement_618_79"] as const;
export type CandidateModel = (typeof CANDIDATE_MODELS)[number];

export type EntryState = "idle" | "swept" | "broke" | "armed" | "invalidated";

export type EntryCandidates = {
  version: string;
  state: EntryState;
  direction: "long" | "short" | null;
  breakTime: number | null;
  breakLevel: number | null;
  /** Shared risk distance (price units) and target for every candidate. */
  risk: number | null;
  target: number | null;
  levels: Partial<Record<CandidateModel, number>>;
};

/**
 * Instruments where a candidate has earned the live entry. Empty until a
 * measured comparison is approved. Editing this map changes live prices, so the
 * golden-set test pins it.
 */
export const ENTRY_MODEL_V2_LIVE: Partial<Record<string, CandidateModel>> = {};

export function liveEntryModelFor(symbol: string, flagOn: boolean): EntryModel {
  if (!flagOn) return "legacy";
  return ENTRY_MODEL_V2_LIVE[symbol] ?? "legacy";
}

export function computeEntryCandidates(args: {
  bias: "Long" | "Short" | "Neutral";
  atr: number;
  candles1h?: ObCandle[] | null;
  lastPrice: number;
}): EntryCandidates {
  const c = args.candles1h ?? [];
  const empty: EntryCandidates = {
    version: ENTRY_FRAMEWORK_VERSION, state: "idle", direction: null,
    breakTime: null, breakLevel: null, risk: null, target: null, levels: {},
  };
  if (args.bias === "Neutral" || !(args.atr > 0) || c.length < 10) return empty;
  const confirm = findSweepAndBreak(c);
  if (!confirm) return empty;
  const long = confirm.long;
  const base = { ...empty, direction: long ? "long" as const : "short" as const, breakTime: c[confirm.breakI]!.time, breakLevel: confirm.breakLevel };
  if (long !== (args.bias === "Long")) return { ...base, state: "invalidated" };

  // Impulse: from the sweep extreme to the furthest extreme after the break.
  const sweepBar = c[confirm.sweepI]!;
  const origin = long ? sweepBar.low : sweepBar.high;
  const after = c.slice(confirm.breakI);
  const extreme = long ? Math.max(...after.map((b) => b.high)) : Math.min(...after.map((b) => b.low));
  // Invalidated when a later close goes back through the sweep extreme.
  if (after.some((b) => (long ? b.close < origin : b.close > origin))) return { ...base, state: "invalidated" };
  const span = Math.abs(extreme - origin);
  if (!(span > 0)) return { ...base, state: "broke" };

  const pad = Math.max(args.atr * 0.15, args.lastPrice * 0.0002);
  const risk = Math.abs(confirm.breakLevel - origin) + pad; // shared risk unit
  const target = extreme;
  const levels: Partial<Record<CandidateModel, number>> = {};
  levels.broken_level = confirm.breakLevel;
  // 0.618-0.79 band of the impulse, midpoint 0.705.
  levels.retracement_618_79 = long ? extreme - span * 0.705 : extreme + span * 0.705;

  // Order block: last opposite candle body before the impulse (sweep..break).
  const kind = long ? "bullish" : "bearish";
  const fromT = c[Math.max(0, confirm.sweepI - 3)]!.time, toT = c[confirm.breakI]!.time;
  const ob = computeOrderBlocks(c, { max: 12 })
    .filter((b) => b.kind === kind && b.time >= fromT && b.time <= toT)
    .sort((a, b) => b.time - a.time)[0];
  if (ob) {
    const bar = c.find((x) => x.time === ob.time);
    levels.order_block = bar ? (long ? Math.max(bar.open, bar.close) : Math.min(bar.open, bar.close)) : (long ? ob.top : ob.bot);
  }
  // Imbalance: near edge of the first directional gap inside the impulse.
  for (let i = confirm.sweepI + 1; i + 1 <= confirm.breakI + 3 && i + 1 < c.length; i++) {
    const a = c[i - 1]!, z = c[i + 1]!;
    if (long ? z.low > a.high : z.high < a.low) { levels.imbalance = long ? z.low : z.high; break; }
  }
  // Drop any level that leaves no room to the target.
  for (const k of Object.keys(levels) as CandidateModel[]) {
    const v = levels[k]!;
    if (long ? v >= target : v <= target) delete levels[k];
  }
  return { ...base, state: "armed", risk, target, levels };
}

/** Equal-risk score for one candidate on forward bars. Unfilled = 0R. */
export function scoreCandidate(
  bars: ObCandle[], long: boolean, entry: number, risk: number, target: number, costR = 0,
): { filled: boolean; r: number } {
  const stop = long ? entry - risk : entry + risk;
  let filled = false;
  for (const b of bars) {
    if (!filled) {
      if (long ? b.low <= entry : b.high >= entry) filled = true; else continue;
    }
    const hitStop = long ? b.low <= stop : b.high >= stop;
    const hitTgt = long ? b.high >= target : b.low <= target;
    if (hitStop) return { filled, r: round(-1 - costR) }; // same bar = stop
    if (hitTgt) return { filled, r: round(Math.abs(target - entry) / risk - costR) };
  }
  if (!filled) return { filled: false, r: 0 };
  const last = bars[bars.length - 1]!.close;
  return { filled, r: round((long ? last - entry : entry - last) / risk - costR) };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Price gap between the live entry and a candidate, in shared-risk units. */
export function entryDiffR(liveEntry: number, cand: EntryCandidates, model: CandidateModel): number | null {
  const v = cand.levels[model];
  if (v == null || !cand.risk) return null;
  return round((v - liveEntry) / cand.risk);
}
