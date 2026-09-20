// Significance gate for every measured claim the product shows a trader.
//
// A hit rate without its sample size is decoration, which is exactly what we
// tell people to refuse. These are pure functions: a Wilson interval for a
// single rate, a two-proportion test for a comparison, and a classifier that
// turns both into plain language the page can print next to the number.

export type ClaimStrength = "established" | "early signal" | "no signal" | "not enough data";

/** Below this many decided trades a rate is reported, never claimed. */
export const SAMPLE_FLOOR = 30;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Wilson 95% interval for a hit rate, in percent. Correct at small n, where the
 * textbook normal interval runs past 0 and 100 and reads as false precision.
 */
export function wilson95(hits: number, n: number): { low: number; high: number } | null {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n <= 0 || hits < 0 || hits > n) return null;
  const z = 1.959964;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: r1(clamp(((centre - spread) / d) * 100, 0, 100)),
    high: r1(clamp(((centre + spread) / d) * 100, 0, 100)),
  };
}

/** Normal CDF, good to ~1e-7. Used only for the two-sided p-value below. */
function phi(x: number): number {
  // Abramowitz and Stegun 26.2.17
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upper = 0.3989422804014327 * Math.exp((-x * x) / 2) * poly;
  return x >= 0 ? 1 - upper : upper;
}

/** Two-sided p-value for "these two hit rates are the same". Null when either sample is empty. */
export function twoProportionP(aHits: number, aN: number, bHits: number, bN: number): number | null {
  if (aN <= 0 || bN <= 0) return null;
  const p1 = aHits / aN;
  const p2 = bHits / bN;
  const pooled = (aHits + bHits) / (aN + bN);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / aN + 1 / bN));
  if (!(se > 0)) return null;
  const z = (p1 - p2) / se;
  return Math.min(1, Math.max(0, 2 * (1 - phi(Math.abs(z)))));
}

/**
 * How much weight a comparison deserves. `not enough data` wins over any p-value:
 * a tiny sample that happens to clear 0.05 is still a coin landing twice.
 */
export function classifyClaim(input: {
  hits: number;
  n: number;
  baselineHits?: number;
  baselineN?: number;
  /** Minimum decided trades before a comparison may be called anything. */
  floor?: number;
}): { strength: ClaimStrength; p: number | null; interval: { low: number; high: number } | null } {
  const floor = input.floor ?? SAMPLE_FLOOR;
  const interval = wilson95(input.hits, input.n);
  if (input.n < floor) return { strength: "not enough data", p: null, interval };
  if (input.baselineN == null || input.baselineHits == null || input.baselineN < floor) {
    return { strength: "not enough data", p: null, interval };
  }
  const p = twoProportionP(input.hits, input.n, input.baselineHits, input.baselineN);
  if (p == null) return { strength: "not enough data", p: null, interval };
  if (p < 0.05) return { strength: "established", p, interval };
  if (p < 0.2) return { strength: "early signal", p, interval };
  return { strength: "no signal", p, interval };
}

/**
 * How many decided trades a gap of this size needs before it can be confirmed,
 * so "we cannot say yet" comes with the price of finding out.
 */
export function samplesNeeded(rateA: number, rateB: number): number | null {
  const p1 = rateA / 100;
  const p2 = rateB / 100;
  const diff = Math.abs(p1 - p2);
  if (!(diff > 0.0001)) return null;
  const pbar = (p1 + p2) / 2;
  // Two-sided alpha 0.05, power 0.8.
  const n = ((1.959964 + 0.8416212) ** 2 * 2 * pbar * (1 - pbar)) / (diff * diff);
  return Math.max(10, Math.ceil(n / 5) * 5);
}

/** One sentence a page can print: the number, its interval, its sample and its weight. */
export function claimSentence(label: string, hits: number, n: number, strength: ClaimStrength): string {
  if (n === 0) return `${label}: nothing decided yet.`;
  const rate = r1((hits / n) * 100);
  const ci = wilson95(hits, n);
  const range = ci ? ` (95% interval ${ci.low}% to ${ci.high}%)` : "";
  const weight =
    strength === "established"
      ? "Established."
      : strength === "early signal"
        ? "Early signal, not confirmed."
        : strength === "no signal"
          ? "No difference from the baseline at this sample."
          : `Not enough data: ${n} decided trade${n === 1 ? "" : "s"}.`;
  return `${label}: ${rate}% over ${n} decided${range}. ${weight}`;
}
