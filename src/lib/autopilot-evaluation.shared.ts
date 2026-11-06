/** Account-currency estimate, not a broker fill or realised account profit. */
export function hypotheticalPnl(r: number | null, riskAmount: number | null): number | null {
  if (r == null || riskAmount == null || !Number.isFinite(r) || !Number.isFinite(riskAmount) || riskAmount <= 0) return null;
  return Math.round(r * riskAmount * 100) / 100;
}