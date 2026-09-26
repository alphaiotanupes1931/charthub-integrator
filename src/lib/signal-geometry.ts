// Last check before a signal enters the record: the levels must describe a real
// trade on the market's actual price. Two faults reached the crypto record:
// a Long filed with its stop above entry and target below (a short's levels
// under a long's label), and BTC/ETH signals filed at Gold's price (~4,360)
// with nonsense stops. Neither can be scored honestly, so both are refused.

export type GeometryInput = {
  bias: string;
  entry: number;
  stop: number;
  tp1: number;
  lastPrice?: number | null;
};

/** How far entry may sit from the live price before we call it the wrong market. */
export const MAX_ENTRY_DEVIATION = 0.15;

export function checkSignalGeometry(s: GeometryInput): { ok: true } | { ok: false; reason: string } {
  const vals = [s.entry, s.stop, s.tp1];
  if (vals.some((v) => !Number.isFinite(v) || v <= 0)) {
    return { ok: false, reason: "Entry, stop and target must all be positive prices." };
  }
  if (s.bias === "Long" && !(s.stop < s.entry && s.entry < s.tp1)) {
    return { ok: false, reason: "A long needs the stop below entry and the target above it." };
  }
  if (s.bias === "Short" && !(s.stop > s.entry && s.entry > s.tp1)) {
    return { ok: false, reason: "A short needs the stop above entry and the target below it." };
  }
  const last = s.lastPrice ?? null;
  if (last != null && Number.isFinite(last) && last > 0) {
    if (Math.abs(s.entry - last) / last > MAX_ENTRY_DEVIATION) {
      return { ok: false, reason: `Entry ${s.entry} is nowhere near the live price ${last}; the levels belong to a different market.` };
    }
  }
  return { ok: true };
}
