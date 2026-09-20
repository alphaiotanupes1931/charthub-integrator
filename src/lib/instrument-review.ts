// Instruments held back from trade-ready output while they are under review.
//
// This is a measurement outcome, not an opinion. An instrument lands here when
// its filed signals lose money at every stop width tested AND a two-year replay
// of the same rules is negative in both the observation and the held-out window.
// Analysis, charts and coaching stay available; only automatic alerts and auto
// trading are withheld, and the entry is removed as soon as forward results turn.

export type InstrumentReview = {
  symbol: string;
  /** Plain-language reason shown to traders. */
  reason: string;
  /** What was measured, so the entry can be re-checked rather than argued about. */
  evidence: string;
  reviewedOn: string;
};

export const INSTRUMENTS_UNDER_REVIEW: InstrumentReview[] = [
  {
    symbol: "GBP/USD",
    reason: "Held back from alerts and auto trading while its results are under review. Analysis and coaching still work.",
    evidence:
      "Filed signals lost money at every stop width tested, and a two-year hourly replay of the same rules was negative " +
      "in both the earlier window (-0.05R per trade) and the held-out window (-0.16R per trade).",
    reviewedOn: "2026-09-20",
  },
];

const BY_SYMBOL = new Map(INSTRUMENTS_UNDER_REVIEW.map((row) => [row.symbol.toUpperCase(), row]));

export function instrumentReview(symbol: string): InstrumentReview | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/** True when an instrument must not produce alerts or automated orders. */
export function isUnderReview(symbol: string): boolean {
  return instrumentReview(symbol) !== null;
}
