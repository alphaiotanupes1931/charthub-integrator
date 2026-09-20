// Correlated instruments scanned in the same second are one bet, not several.
//
// Filing US30, SPX500 and NAS100 short at 09:15:57 and counting three
// independent signals inflates both the sample size and the loss when the
// index complex moves against us. The highest-graded signal in a cluster is the
// published one; the rest are kept for the audit trail and flagged correlated
// so every aggregate can hold them out.

export type ClusterId = "indices-us" | "metals" | "usd-majors" | "crypto" | "energy" | null;

const CLUSTERS: Array<{ id: Exclude<ClusterId, null>; symbols: string[] }> = [
  { id: "indices-us", symbols: ["US30", "SPX500", "NAS100", "US2000"] },
  { id: "metals", symbols: ["XAUUSD", "XAGUSD", "XAU/USD", "XAG/USD"] },
  { id: "usd-majors", symbols: ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "EUR/USD", "GBP/USD", "AUD/USD", "NZD/USD"] },
  { id: "crypto", symbols: ["BTCUSD", "ETHUSD", "XRPUSD", "BTC/USD", "ETH/USD", "XRP/USD"] },
  { id: "energy", symbols: ["WTICOUSD", "USOIL", "WTI", "BCOUSD", "UKOIL"] },
];

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Which correlation cluster an instrument belongs to, or null when it stands alone. */
export function clusterOf(symbol: string): ClusterId {
  const key = normalizeSymbol(symbol);
  for (const c of CLUSTERS) {
    if (c.symbols.some((s) => normalizeSymbol(s) === key)) return c.id;
  }
  return null;
}

const GRADE_RANK: Record<string, number> = { "A+": 5, A: 4, B: 3, C: 2, D: 1 };
const rankOf = (grade: string) => GRADE_RANK[grade.trim().toUpperCase()] ?? 0;

/** Minutes within which two scans on correlated instruments count as one bet. */
export const CLUSTER_WINDOW_MINUTES = 15;

export type ClusterPeer = { grade: string; bias: string; createdAt: string };

/**
 * True when this signal duplicates an already-filed bet: same cluster, same
 * direction, inside the window, and not better graded than what is already
 * filed. Ties go to the signal filed first, so the decision never flips on a
 * re-run.
 */
export function isCorrelatedDuplicate(
  signal: { symbol: string; grade: string; bias: string; createdAt: string },
  peers: Array<ClusterPeer & { symbol: string }>,
): boolean {
  const cluster = clusterOf(signal.symbol);
  if (!cluster) return false;
  const at = Date.parse(signal.createdAt);
  if (!Number.isFinite(at)) return false;
  const dir = signal.bias.trim().toLowerCase();
  return peers.some((p) => {
    if (clusterOf(p.symbol) !== cluster) return false;
    if (normalizeSymbol(p.symbol) === normalizeSymbol(signal.symbol)) return false;
    if (p.bias.trim().toLowerCase() !== dir) return false;
    const pAt = Date.parse(p.createdAt);
    if (!Number.isFinite(pAt)) return false;
    if (Math.abs(at - pAt) > CLUSTER_WINDOW_MINUTES * 60_000) return false;
    return rankOf(p.grade) >= rankOf(signal.grade);
  });
}
