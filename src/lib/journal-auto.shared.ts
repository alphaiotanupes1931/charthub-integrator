/** Map a scan timeframe ("60", "240", "15m", "1h") to the journal's labels. */
export function journalTimeframe(tf: string | null | undefined): string {
  const s = String(tf ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    "1": "1m", "1m": "1m", "5": "5m", "5m": "5m", "15": "15m", "15m": "15m", "30": "30m", "30m": "30m",
    "60": "1H", "1h": "1H", "240": "4H", "4h": "4H", "d": "1D", "1d": "1D", "1440": "1D", "w": "1W", "1w": "1W",
  };
  return map[s] ?? "1H";
}
