// Day 6: the part that decides. Pure functions, no I/O.
export { wilson95 } from "@/lib/statistics";

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
const sd = (x: number[]) => { const m = mean(x); return x.length > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)) : 0; };

/** Deterministic PRNG so every run is reproducible. */
export function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** Block bootstrap, resampling whole days so same-day setups stay together. */
export function dayBootstrap(rows: { day: string; v: number }[], iters = 2000, seed = 7) {
  const byDay = new Map<string, number[]>();
  for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r.v]);
  const days = [...byDay.values()];
  const rand = rng(seed);
  const means: number[] = [];
  for (let k = 0; k < iters; k++) {
    let s = 0, n = 0;
    for (let d = 0; d < days.length; d++) { const day = days[Math.floor(rand() * days.length)]!; for (const v of day) { s += v; n++; } }
    means.push(n ? s / n : 0);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(rows.map((r) => r.v)), lo: means[Math.floor(iters * 0.025)]!, hi: means[Math.floor(iters * 0.975)]!, pPositive: means.filter((m) => m > 0).length / iters, days: days.length };
}

/** Time-ordered folds with an embargo gap (seconds) dropped on each side of every test fold. */
export function walkForward<T extends { time: number }>(rows: T[], folds: number, embargoSec: number) {
  const s = [...rows].sort((a, b) => a.time - b.time);
  if (!s.length) return [];
  const t0 = s[0]!.time, t1 = s[s.length - 1]!.time, w = (t1 - t0) / folds;
  return Array.from({ length: folds }, (_, f) => {
    const a = t0 + f * w, b = a + w;
    return {
      test: s.filter((r) => r.time >= a && r.time < b + (f === folds - 1 ? 1 : 0)),
      train: s.filter((r) => r.time < a - embargoSec || r.time >= b + embargoSec),
    };
  });
}

/**
 * Probability of backtest overfitting (CSCV, Bailey et al. 2017). `m` is a
 * matrix [period][variant] of returns. Split periods into S blocks, and for
 * each half/half combination check whether the in-sample best variant ranks
 * below the median out of sample.
 */
export function pbo(m: number[][], S = 8): { pbo: number; combos: number } {
  const T = m.length, N = m[0]?.length ?? 0;
  if (N < 2 || T < S) return { pbo: NaN, combos: 0 };
  const size = Math.floor(T / S);
  const blocks = Array.from({ length: S }, (_, i) => m.slice(i * size, (i + 1) * size));
  const combos = choose([...Array(S).keys()], S / 2);
  let below = 0;
  for (const c of combos) {
    const inS = c.flatMap((i) => blocks[i]!), outS = blocks.filter((_, i) => !c.includes(i)).flat();
    const perf = (rows: number[][]) => Array.from({ length: N }, (_, j) => mean(rows.map((r) => r[j]!)));
    const pi = perf(inS), po = perf(outS);
    const best = pi.indexOf(Math.max(...pi));
    const rank = po.filter((v) => v < po[best]!).length / (N - 1); // 0..1
    if (rank < 0.5) below++;
  }
  return { pbo: below / combos.length, combos: combos.length };
}
function choose(a: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (a.length < k) return [];
  const [h, ...t] = a;
  return [...choose(t, k - 1).map((c) => [h!, ...c]), ...choose(t, k)];
}

/** Deflated Sharpe ratio (Bailey & Lopez de Prado 2014): P(true SR > 0) after `trials` tries. */
export function deflatedSharpe(x: number[], trials: number, trialSrVar: number): { sr: number; dsr: number; sr0: number } {
  const n = x.length, s = sd(x), sr = s ? mean(x) / s : 0;
  const m = mean(x);
  const skew = n > 2 && s ? x.reduce((a, v) => a + ((v - m) / s) ** 3, 0) / n : 0;
  const kurt = n > 3 && s ? x.reduce((a, v) => a + ((v - m) / s) ** 4, 0) / n : 3;
  const g = 0.5772156649;
  const z = (p: number) => normInv(p);
  const sr0 = trials > 1 ? Math.sqrt(trialSrVar) * ((1 - g) * z(1 - 1 / trials) + g * z(1 - 1 / (trials * Math.E))) : 0;
  const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  return { sr, sr0, dsr: normCdf(((sr - sr0) * Math.sqrt(n - 1)) / denom) };
}

/** Paired power check: minimum detectable mean difference at 5% two-sided, 80% power. */
export function minDetectable(diffs: number[]) { return diffs.length ? (2.8 * sd(diffs)) / Math.sqrt(diffs.length) : Infinity; }

export function normCdf(x: number) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
export function normInv(p: number) { // Acklam
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1); }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}
export { mean, sd };
