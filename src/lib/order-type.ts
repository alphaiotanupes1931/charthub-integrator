// One order-type rule for every screen and for filing. A strategy never sets
// the order type by hand: it is derived from side and entry vs the price the
// SCAN used (refPrice), so a later on-screen price cannot relabel it.
//
//   Short, entry above price -> SELL LIMIT     Long, entry below price -> BUY LIMIT
//   Short, entry below price -> SELL STOP      Long, entry above price -> BUY STOP
//   Within tolerance of price -> MARKET

export type OrderType = "BUY LIMIT" | "BUY STOP" | "BUY MARKET" | "SELL LIMIT" | "SELL STOP" | "SELL MARKET";

export function orderTolerance(refPrice: number, risk?: number | null): number {
  const base = refPrice * 0.0002;
  return risk && isFinite(risk) && risk > 0 ? Math.min(Math.max(base, risk * 0.05), refPrice * 0.0005) : base;
}

export function deriveOrderType(
  side: string | null | undefined,
  entry: number | null | undefined,
  refPrice: number | null | undefined,
  risk?: number | null,
): OrderType | null {
  const s = (side ?? "").trim().toLowerCase();
  if ((s !== "long" && s !== "short") || typeof entry !== "number" || typeof refPrice !== "number") return null;
  if (!isFinite(entry) || !isFinite(refPrice) || refPrice <= 0) return null;
  const tol = orderTolerance(refPrice, risk);
  if (s === "long") {
    if (entry > refPrice + tol) return "BUY STOP";
    if (entry < refPrice - tol) return "BUY LIMIT";
    return "BUY MARKET";
  }
  if (entry < refPrice - tol) return "SELL STOP";
  if (entry > refPrice + tol) return "SELL LIMIT";
  return "SELL MARKET";
}

/** True when a stored/stated order type contradicts the table. */
export function orderTypeContradicts(
  stated: string | null | undefined,
  side: string,
  entry: number,
  refPrice: number,
  risk?: number | null,
): boolean {
  if (!stated) return false;
  const derived = deriveOrderType(side, entry, refPrice, risk);
  if (!derived) return false;
  const norm = stated.trim().toUpperCase().replace(/_/g, " ");
  if (derived.endsWith("MARKET")) return false;
  return norm !== derived;
}

export function orderTypeHelp(t: OrderType): string {
  switch (t) {
    case "BUY STOP": return "Entry is above the scan price - triggers on breakout";
    case "BUY LIMIT": return "Entry is below the scan price - waits for pullback";
    case "SELL STOP": return "Entry is below the scan price - triggers on breakdown";
    case "SELL LIMIT": return "Entry is above the scan price - waits for pullback";
    default: return "Entry is at the scan price";
  }
}
