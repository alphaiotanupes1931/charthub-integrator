// Per-instrument entry and stop, in trial (shadow) only.
//
// Live signals still use the shared entry rule. This computes where the entry and
// stop would sit if they followed this market's own measured pullback depth
// instead: Silver pulls back deeper than Gold, so its limit sits deeper in the leg
// and its stop clears Silver's deep pullback, not Gold's. The result is attached to
// the scan beside the live levels so the two can be compared before switching.

export type EntryShadowProfile = {
  medianPullback: number;
  deepPullback: number;
  stopBufferAtr: number;
  barsSampled: number;
};

export type EntryShadow = {
  entry: number;
  stop: number;
  medianPullback: number;
  deepPullback: number;
  /** Signed difference vs the live entry, in ATR. Positive = deeper than live. */
  entryShiftAtr: number | null;
  /** Stop distance from entry, in ATR. */
  riskAtr: number;
  note: string;
};

const MIN_BARS = 200;

export function instrumentEntryShadow(args: {
  bias: "Long" | "Short" | "Neutral";
  high: number;
  low: number;
  atr: number;
  liveEntry?: number | null;
  profile: EntryShadowProfile | null | undefined;
}): EntryShadow | null {
  const { bias, high, low, atr, liveEntry, profile } = args;
  if (bias === "Neutral" || !profile || profile.barsSampled < MIN_BARS) return null;
  const leg = high - low;
  if (!(leg > 0) || !(atr > 0)) return null;
  const med = Math.min(0.9, Math.max(0.2, profile.medianPullback));
  const deep = Math.min(1, Math.max(med, profile.deepPullback));
  const buf = Math.max(0.1, profile.stopBufferAtr) * atr;
  const long = bias === "Long";
  const entry = long ? high - med * leg : low + med * leg;
  const stop = long ? high - deep * leg - buf : low + deep * leg + buf;
  const shift =
    liveEntry != null && Number.isFinite(liveEntry)
      ? +(((long ? liveEntry - entry : entry - liveEntry) / atr)).toFixed(2)
      : null;
  return {
    entry,
    stop,
    medianPullback: med,
    deepPullback: deep,
    entryShiftAtr: shift,
    riskAtr: +(Math.abs(entry - stop) / atr).toFixed(2),
    note: `Trial only: entry at this market's typical ${(med * 100).toFixed(0)}% pullback, stop past its deep ${(deep * 100).toFixed(0)}% pullback.`,
  };
}
