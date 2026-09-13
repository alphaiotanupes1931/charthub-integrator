// Client-safe helpers for turning the account's own OANDA instrument list into
// chart symbols. No secrets and no server imports.
//
// OANDA's tradable set differs by regulated entity (country), so the dropdown is
// built from GET /v3/accounts/{accountID}/instruments and anything the account
// cannot trade is greyed out rather than silently failing at order time.

export type OandaInstrument = { name: string; displayName: string; type: string };

/** TradeMind ticker -> OANDA instrument name for the curated shortlist. */
export const OANDA_NAME_BY_TICKER: Record<string, string> = {
  "XAU/USD": "XAU_USD",
  "XAG/USD": "XAG_USD",
  NAS100: "NAS100_USD",
  US30: "US30_USD",
  SPX500: "SPX500_USD",
  "WTI Oil": "WTICO_USD",
  "EUR/USD": "EUR_USD",
  "GBP/USD": "GBP_USD",
  "USD/JPY": "USD_JPY",
};

/** TradingView symbol for an OANDA instrument name (EUR_USD -> OANDA:EURUSD). */
export function tvSymbolForOanda(name: string): string {
  return `OANDA:${name.replace(/_/g, "")}`;
}

/** Human label OANDA itself shows, falling back to the raw instrument name. */
export function oandaLabel(i: OandaInstrument): string {
  return i.displayName || i.name.replace(/_/g, "/");
}

/**
 * Instruments a US-regulated OANDA account will never list. Cash indices and
 * spot oil are CFDs, which US retail accounts cannot hold - executing those in
 * the US means a futures broker (Tradovate, IBKR), not OANDA.
 */
export const FUTURES_ONLY_TICKERS = new Set(["NAS100", "US30", "SPX500", "WTI Oil"]);
