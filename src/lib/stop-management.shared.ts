// Runner stop rules after the first target.
// Lesson from the US30 trade: pulling the stop up to TP1 right after banking
// half turned old resistance into a stop-out on the very retest that was an
// add opportunity. So after TP1 the stop sits at break-even and only starts
// trailing once price has run well past TP1, staying a wide gap behind price.

/** Trailing starts only once the trade is this many R ahead. */
export const TRAIL_START_R = 3;
/** Trailing stop stays this many R behind price. */
export const TRAIL_GAP_R = 1.5;

export function desiredRunnerStop(p: {
  long: boolean;
  entry: number;
  stop: number;
  price: number;
  risk: number;
  breakEven: boolean;
  trail: boolean;
}): number | null {
  const { long, entry, stop, price, risk } = p;
  if (risk <= 0) return null;
  const openProfit = long ? price - entry : entry - price;
  if (openProfit < risk) return null;
  let desired: number | null = null;
  const protectedAlready = long ? stop >= entry : stop <= entry;
  if (p.breakEven && !protectedAlready) desired = entry;
  if (p.trail && openProfit >= risk * TRAIL_START_R) {
    const trailStop = long ? price - risk * TRAIL_GAP_R : price + risk * TRAIL_GAP_R;
    const better = long ? trailStop > Math.max(stop, entry) : trailStop < Math.min(stop, entry);
    if (better) desired = trailStop;
  }
  return desired;
}

export const RUNNER_MANAGEMENT_TEXT =
  "After TP1: bank half and move the stop to break-even, not to TP1. The old TP1 level is now support (resistance for shorts) - if price pulls back to it and the 15m reacts, that is an add with its own stop, not an exit. Only trail the runner once it is about 3R ahead, keeping the stop about 1.5R behind price.";
