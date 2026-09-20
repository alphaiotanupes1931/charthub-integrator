// The bar walk, extracted so exactly one piece of code decides what price did.
//
// The live resolver and the historical backfill/verification pass both call this.
// If they each had their own loop, a backfilled MFE and a live MFE would drift
// apart and the scoreboard would be averaging two different measurements again.
//
// Conventions, all deliberate:
//  - Only bars stamped strictly after the signal was filed are considered. No
//    look-ahead, and no crediting the bar the signal was born on.
//  - When one bar contains both the stop and the target, it counts as a STOP.
//    We cannot see intrabar sequence, so we take the pessimistic read.
//  - MAE and MFE are measured up to and including the resolving bar, in R.

export type ReplayBar = { time: number; high: number; low: number; close: number };

export type ReplaySignal = {
  bias: string;
  entry: number;
  stop: number;
  tp1: number;
  /** ISO timestamp the signal was filed. */
  created_at: string;
};

export type ReplayVerdict = {
  /**
   * "unresolved" means neither level printed in the bars supplied.
   * "unfilled" means the planned entry was never traded back to, so there was
   * no position to win or lose with. Only produced when `requireFill` is set.
   */
  status: "target" | "stop" | "unresolved" | "unfilled";
  /** Gross R at the resolving level; null while unresolved. */
  realizedR: number | null;
  /** Maximum adverse excursion in R (heat taken). */
  maeR: number;
  /** Maximum favourable excursion in R (ground made). */
  mfeR: number;
  /** Bars walked, whether or not it resolved. */
  bars: number;
  /** Close of the last bar walked, for marking an expiry to market. */
  lastClose: number | null;
  /** Time of the resolving bar, for spot checks against a chart. */
  resolvedAt: number | null;
};

export type ReplayOptions = {
  /**
   * Score the signal as a resting limit order: nothing counts until price trades
   * back to the planned entry. Without this a scan is credited with a trade the
   * account never had, which is what let first-bar "free wins" into the record.
   */
  requireFill?: boolean;
};

/** Long or short, or null when the scan had no directional opinion. */
export function replayDirection(bias: string): "long" | "short" | null {
  const b = bias.trim().toLowerCase();
  if (b.startsWith("l") || b === "buy" || b === "bull" || b === "bullish") return "long";
  if (b.startsWith("s") || b === "sell" || b === "bear" || b === "bearish") return "short";
  return null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Bars filed after the signal, in time order. */
export function forwardBars(bars: ReplayBar[], createdAtIso: string): ReplayBar[] {
  const createdMs = new Date(createdAtIso).getTime();
  return bars.filter((b) => b.time * 1000 > createdMs).sort((a, b) => a.time - b.time);
}

/**
 * Walk the bars and report what price did. Returns null when the signal has no
 * direction or no risk distance, i.e. nothing scorable.
 */
export function replayForward(sig: ReplaySignal, bars: ReplayBar[]): ReplayVerdict | null {
  const direction = replayDirection(sig.bias);
  const risk = Math.abs(sig.entry - sig.stop);
  if (!direction || !(risk > 0)) return null;

  const forward = forwardBars(bars, sig.created_at);
  const long = direction === "long";
  const rMultiple = r2(Math.abs(sig.tp1 - sig.entry) / risk);

  let mae = 0;
  let mfe = 0;
  for (let i = 0; i < forward.length; i++) {
    const bar = forward[i]!;
    const adverse = long ? sig.entry - bar.low : bar.high - sig.entry;
    if (adverse > 0) mae = Math.max(mae, adverse / risk);
    const favourable = long ? bar.high - sig.entry : sig.entry - bar.low;
    if (favourable > 0) mfe = Math.max(mfe, favourable / risk);

    const hitStop = long ? bar.low <= sig.stop : bar.high >= sig.stop;
    const hitTarget = long ? bar.high >= sig.tp1 : bar.low <= sig.tp1;
    if (hitStop || hitTarget) {
      return {
        status: hitStop ? "stop" : "target",
        realizedR: hitStop ? -1 : rMultiple,
        maeR: r2(mae),
        mfeR: r2(mfe),
        bars: i + 1,
        lastClose: bar.close,
        resolvedAt: bar.time,
      };
    }
  }

  return {
    status: "unresolved",
    realizedR: null,
    maeR: r2(mae),
    mfeR: r2(mfe),
    bars: forward.length,
    lastClose: forward.length ? forward[forward.length - 1]!.close : null,
    resolvedAt: null,
  };
}
