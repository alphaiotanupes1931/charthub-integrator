export function measuredRate(wins: number, losses: number): number | null {
  const decided = wins + losses;
  return decided > 0 ? Math.round(wins / decided * 1000) / 10 : null;
}

export type AccuracyCounts = { wins: number; losses: number; breakeven?: number; updatedAt: string | null };
export type PlatformAccuracy = { scans: AccuracyCounts; trades: AccuracyCounts };