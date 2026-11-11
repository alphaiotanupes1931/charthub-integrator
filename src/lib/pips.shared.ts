// Pip size per instrument. FX 0.0001 (JPY pairs 0.01), gold 0.10, silver 0.01,
// oil 0.01, indices and crypto 1 point.
export function pipSize(symbol: string): number {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/XAU|GOLD/.test(s)) return 0.1;
  if (/XAG|SILVER/.test(s)) return 0.01;
  if (/WTI|USOIL|XTI|BRENT|UKOIL/.test(s)) return 0.01;
  if (/^[A-Z]{6}$/.test(s) && !/BTC|ETH|SOL/.test(s)) return s.includes("JPY") ? 0.01 : 0.0001;
  return 1;
}

/** Signed pips between two prices; positive when the move favours the side. */
export function pipsBetween(symbol: string, from: number, to: number, side: "Long" | "Short" | "long" | "short" = "Long"): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const dir = side.toLowerCase() === "short" ? -1 : 1;
  return Math.round(((to - from) * dir / pipSize(symbol)) * 10) / 10;
}

export function formatPips(p: number | null): string {
  if (p == null) return "-";
  return `${p > 0 ? "+" : ""}${p.toLocaleString(undefined, { maximumFractionDigits: 1 })} pips`;
}
