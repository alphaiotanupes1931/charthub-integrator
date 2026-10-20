// Converts a unit-based position size into TradeLocker lots that respect the
// broker's contract size, minimum, maximum and step for that instrument.
export type TLVolumeRules = {
  contractSize: number | null; // units per 1 lot
  minLots: number | null;
  maxLots: number | null;
  stepLots: number | null;
};

export type TLVolumeResult =
  | { ok: true; lots: number; capped: boolean }
  | { ok: false; reason: string };

export function unitsToTradeLockerLots(units: number, rules: TLVolumeRules): TLVolumeResult {
  if (!Number.isFinite(units) || units <= 0) return { ok: false, reason: "The trade size is zero." };
  const contract = rules.contractSize && rules.contractSize > 0 ? rules.contractSize : 1;
  let lots = units / contract;
  let capped = false;
  if (rules.maxLots && rules.maxLots > 0 && lots > rules.maxLots) {
    lots = rules.maxLots;
    capped = true;
  }
  const step = rules.stepLots && rules.stepLots > 0 ? rules.stepLots : 0.01;
  lots = Math.floor(lots / step + 1e-9) * step;
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step))));
  lots = Number(lots.toFixed(decimals));
  const min = rules.minLots && rules.minLots > 0 ? rules.minLots : step;
  if (lots < min) {
    return {
      ok: false,
      reason: `This size is below the broker's minimum of ${min} lot${min === 1 ? "" : "s"}. Raise your risk per trade or skip this one.`,
    };
  }
  return { ok: true, lots, capped };
}
