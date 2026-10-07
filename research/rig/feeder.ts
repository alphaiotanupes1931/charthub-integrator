// Day 2: bar feeder. The detector only ever receives bars at or before the
// current index; higher-timeframe bars only once they have fully closed.
// Look-ahead is impossible by construction: the view is a copy, not a window.

export type Bar = { time: number; open: number; high: number; low: number; close: number };

export function* feed<T extends Bar>(bars: T[], opts: { warmup: number; window: number }) {
  for (let i = opts.warmup; i < bars.length; i++) {
    // slice() copies, so nothing downstream can index past i.
    yield { i, now: bars[i]!, view: bars.slice(Math.max(0, i - opts.window + 1), i + 1) };
  }
}

/** Higher-timeframe bars whose close time is at or before `nowCloseSec`. */
export function completedHtf<T extends Bar>(htf: T[], htfSec: number, nowCloseSec: number): T[] {
  let lo = 0, hi = htf.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (htf[m]!.time + htfSec <= nowCloseSec) lo = m + 1; else hi = m; }
  return htf.slice(0, lo);
}
