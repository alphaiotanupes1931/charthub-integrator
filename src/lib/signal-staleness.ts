// Staleness guard for filed signals.
//
// Measurement over 500 resolved historical signals found that most of the
// published record was filed AFTER price had already left the planned entry: the
// median signal sat 0.69R past its own entry on the first candle after filing,
// and 145 of them resolved on that very candle, 118 of those as wins that never
// moved against the trade. Those are reports of a move that already happened, not
// tradeable calls, and a trader following them cannot buy at a price that has gone.
//
// So a signal is only publishable while its entry price is still reachable. This
// module is the single pure place that decides that, so the scanner display and
// the filing path cannot disagree.

/** How far past its entry a signal may sit, in planned R, and still be filed. */
export const STALE_TOLERANCE_R = 0.5;

export type StalenessRead = {
  /** True when the entry price has run away too far to publish this signal. */
  stale: boolean;
  /**
   * How far past the planned entry price sat, in planned R. 0 means price has not
   * passed the entry at all (including still approaching it). Null when it cannot
   * be measured, which is treated as stale.
   */
  distanceR: number | null;
  /** Plain reason, safe to show a trader or store as a refusal note. */
  reason: string | null;
};

/**
 * Judge one signal against the price the scanner can actually see.
 *
 * `lastPrice` is the market price the plan was measured against. A long is stale
 * when price has already risen past the entry, a short when it has already fallen
 * past it — in both cases the entry is behind the market. Price that has NOT yet
 * reached the entry is not stale: that is a normal pending limit order.
 */
export function evaluateEntryStaleness(input: {
  bias: string;
  entry: number;
  stop: number;
  lastPrice: number | null | undefined;
  toleranceR?: number;
}): StalenessRead {
  const tolerance = input.toleranceR ?? STALE_TOLERANCE_R;
  const side = input.bias.trim().toLowerCase();
  if (side !== "long" && side !== "short") {
    return { stale: true, distanceR: null, reason: "Only Long or Short signals can be filed." };
  }
  const risk = Math.abs(input.entry - input.stop);
  if (!isFinite(risk) || risk <= 0) {
    return { stale: true, distanceR: null, reason: "Entry and stop are the same price, so risk cannot be measured." };
  }
  const price = input.lastPrice;
  if (typeof price !== "number" || !isFinite(price)) {
    return {
      stale: true,
      distanceR: null,
      reason: "No market price at filing time, so it cannot be shown the entry is still reachable.",
    };
  }
  const past = side === "long" ? price - input.entry : input.entry - price;
  const distanceR = Math.round(Math.max(0, past / risk) * 1000) / 1000;
  if (distanceR > tolerance) {
    return {
      stale: true,
      distanceR,
      reason: `Entry already gone: price is ${distanceR}R past the planned entry, above the ${tolerance}R limit.`,
    };
  }
  return { stale: false, distanceR, reason: null };
}
