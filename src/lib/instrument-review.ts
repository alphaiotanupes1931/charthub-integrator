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

// GBP/USD was held here from 2026-09-20 (negative replay) and released on
// 2026-11-09 at the owner's request so the Demo autopilot can trade it again.
export const INSTRUMENTS_UNDER_REVIEW: InstrumentReview[] = [];

const BY_SYMBOL = new Map(INSTRUMENTS_UNDER_REVIEW.map((row) => [row.symbol.toUpperCase(), row]));

export function instrumentReview(symbol: string): InstrumentReview | null {
  return BY_SYMBOL.get(symbol.trim().toUpperCase()) ?? null;
}

/** True when an instrument must not produce alerts or automated orders. */
export function isUnderReview(symbol: string): boolean {
  return instrumentReview(symbol) !== null;
}
