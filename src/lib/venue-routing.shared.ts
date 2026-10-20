// Picks which connected venue an order goes to, per instrument.
// OANDA (US accounts) only trades forex pairs; TradeLocker covers indices,
// metals, oil and crypto. So non-forex orders never go to OANDA when
// TradeLocker is connected.

const FX = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "SGD", "HKD", "MXN", "ZAR"]);

export function isForexPair(symbol: string): boolean {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length !== 6) return false;
  return FX.has(s.slice(0, 3)) && FX.has(s.slice(3));
}

export function chooseVenue(requested: string, symbol: string, connected: string[]): string {
  const hasTL = connected.includes("tradelocker");
  const hasOanda = connected.includes("oanda");
  if (!isForexPair(symbol)) {
    if (hasTL) return "tradelocker";
    return requested;
  }
  if (requested === "oanda" && !hasOanda && hasTL) return "tradelocker";
  if (requested === "tradelocker" && !hasTL && hasOanda) return "oanda";
  return requested;
}
