// Research harness for the entry framework. One named hypothesis against one
// named null per run. Pure: callers supply bars, results are logged by callers.

import { computeEntryCandidates, scoreCandidate, CANDIDATE_MODELS, type CandidateModel } from "@/lib/entry-candidates";
import type { ObCandle } from "@/lib/orderBlocks";
import { costInR } from "@/lib/trading-costs";

export type SetupResult = {
  breakTime: number;
  long: boolean;
  /** Market entry at the close of the break bar (the "enter at the break" rule). */
  breakClose: { filled: true; r: number };
  candidates: Partial<Record<CandidateModel, { filled: boolean; r: number }>>;
};

/** Walk history, arm each distinct confirmed break once, score every entry with equal risk. */
export function replayEntrySetups(symbol: string, bars: ObCandle[], opts: { window?: number; horizon?: number; atrLen?: number } = {}): SetupResult[] {
  const W = opts.window ?? 150, H = opts.horizon ?? 72, L = opts.atrLen ?? 14;
  const seen = new Set<number>();
  const out: SetupResult[] = [];
  for (let t = W; t < bars.length - 1; t++) {
    const win = bars.slice(t - W, t + 1);
    const atr = win.slice(-L).reduce((a, b) => a + (b.high - b.low), 0) / L;
    const last = win[win.length - 1]!;
    for (const bias of ["Long", "Short"] as const) {
      const cand = computeEntryCandidates({ bias, atr, lastPrice: last.close, candles1h: win });
      if (cand.state !== "armed" || cand.breakTime == null || seen.has(cand.breakTime)) continue;
      // Only arm on the bar the break closed, so nothing is chosen with hindsight.
      if (cand.breakTime !== last.time) continue;
      seen.add(cand.breakTime);
      const long = cand.direction === "long";
      const fwd = bars.slice(t + 1, t + 1 + H);
      if (fwd.length < 5) continue;
      const risk = cand.risk!, target = cand.target!;
      const bc = scoreCandidate([{ ...fwd[0]!, low: Math.min(fwd[0]!.low, last.close), high: Math.max(fwd[0]!.high, last.close) }, ...fwd.slice(1)], long, last.close, risk, target, costInR(symbol, last.close, risk));
      // Target must be ahead of the break close for a market entry to make sense.
      const breakR = (long ? target <= last.close : target >= last.close) ? 0 : bc.r;
      const candidates: SetupResult["candidates"] = {};
      for (const m of CANDIDATE_MODELS) {
        const lv = cand.levels[m];
        candidates[m] = lv == null ? { filled: false, r: 0 } : scoreCandidate(fwd, long, lv, risk, target, costInR(symbol, lv, risk));
      }
      out.push({ breakTime: cand.breakTime, long, breakClose: { filled: true, r: breakR }, candidates });
    }
  }
  return out;
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
const sd = (x: number[]) => { const m = mean(x); return x.length > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)) : 0; };

/**
 * Power check, run first. Paired design: minimum detectable mean difference at
 * 5% two-sided, 80% power is about 2.8 * sd(diff) / sqrt(n). If that exceeds
 * the effect that would change the decision, stop.
 */
export function powerCheck(diffs: number[], decisionEffectR: number): { n: number; sdDiff: number; mdeR: number; adequate: boolean } {
  const s = sd(diffs);
  const mde = diffs.length ? (2.8 * s) / Math.sqrt(diffs.length) : Infinity;
  return { n: diffs.length, sdDiff: round(s), mdeR: round(mde), adequate: mde <= decisionEffectR };
}

/** Paired comparison of one candidate vs the baseline, pooled, with a 70/30 build/held-out split. */
export function compareToBaseline(setups: SetupResult[], model: CandidateModel | "break_close", baseline: CandidateModel | "break_close") {
  const pick = (s: SetupResult, m: CandidateModel | "break_close") => (m === "break_close" ? s.breakClose.r : s.candidates[m]?.r ?? 0);
  const filled = (s: SetupResult, m: CandidateModel | "break_close") => (m === "break_close" ? true : !!s.candidates[m]?.filled);
  const sorted = [...setups].sort((a, b) => a.breakTime - b.breakTime);
  const cut = Math.floor(sorted.length * 0.7);
  const part = (xs: SetupResult[]) => {
    const a = xs.map((s) => pick(s, model)), b = xs.map((s) => pick(s, baseline));
    const d = a.map((v, i) => v - b[i]!);
    const se = xs.length > 1 ? sd(d) / Math.sqrt(xs.length) : Infinity;
    return {
      n: xs.length,
      fillRate: round(xs.filter((s) => filled(s, model)).length / Math.max(1, xs.length)),
      totalR: round(a.reduce((x, y) => x + y, 0)), avgR: round(mean(a)),
      baselineTotalR: round(b.reduce((x, y) => x + y, 0)), baselineAvgR: round(mean(b)),
      deltaTotalR: round(d.reduce((x, y) => x + y, 0)), deltaAvgR: round(mean(d)),
      t: Number.isFinite(se) && se > 0 ? round(mean(d) / se) : null,
    };
  };
  return { model, baseline, pooled: part(sorted), build: part(sorted.slice(0, cut)), heldOut: part(sorted.slice(cut)) };
}

// ---------- Session-sequence null benchmark ----------

export type WindowStat = { width: number; lenBars: number; vol: number; breached: boolean };

/**
 * Excess breach rate of real Asia ranges by the following London window, against
 * random windows matched on width (in ATR), window length and realised volatility.
 * Matching is by quantile bins of width/vol; length is fixed by construction.
 */
export function sessionNullBenchmark(real: WindowStat[], random: WindowStat[], bins = 4) {
  const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
  const wEdges = Array.from({ length: bins - 1 }, (_, i) => q(real.map((r) => r.width), (i + 1) / bins));
  const vEdges = Array.from({ length: bins - 1 }, (_, i) => q(real.map((r) => r.vol), (i + 1) / bins));
  const bin = (x: number, e: number[]) => e.filter((v) => x > v).length;
  const key = (w: WindowStat) => `${bin(w.width, wEdges)}-${bin(w.vol, vEdges)}-${w.lenBars}`;
  const cells = new Map<string, { real: number; realHit: number; rnd: number; rndHit: number }>();
  for (const [arr, isReal] of [[real, true], [random, false]] as const) {
    for (const w of arr) {
      const c = cells.get(key(w)) ?? { real: 0, realHit: 0, rnd: 0, rndHit: 0 };
      if (isReal) { c.real++; if (w.breached) c.realHit++; } else { c.rnd++; if (w.breached) c.rndHit++; }
      cells.set(key(w), c);
    }
  }
  let n = 0, realHits = 0, expected = 0;
  for (const c of cells.values()) {
    if (c.rnd < 30 || c.real === 0) continue; // minimum 30 per cell
    n += c.real; realHits += c.realHit; expected += c.real * (c.rndHit / c.rnd);
  }
  return {
    n,
    realRate: n ? round(realHits / n) : null,
    nullRate: n ? round(expected / n) : null,
    excess: n ? round((realHits - expected) / n) : null,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
