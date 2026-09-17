// Trading costs, in price units, so every published result can be reported net
// as well as gross.
//
// Why this matters more than a flat haircut: spread and slippage are a FIXED
// price distance, while our risk is measured in ATR. The same 0.2 point spread
// on gold eats twice the share of R on a 1.1x ATR stop as it does on a 2.2x one,
// so gross numbers are biased against exactly the tight-stopped, high-conviction
// setups we are trying to evaluate.
//
// Values are typical retail round-turn conditions during the instrument's active
// session, not best-case quotes: spread plus an allowance for entry and exit
// slippage. They are deliberately conservative. Cost is charged once per trade
// (entry plus exit combined).

export type CostModel = {
  /** Typical quoted spread, in price units. */
  spread: number;
  /** Allowance for entry and exit slippage combined, in price units. */
  slippage: number;
};

/** Keys accept both the display ticker and the raw OANDA name. */
const COSTS: Record<string, CostModel> = {
  // Metals
  "XAU/USD": { spread: 0.3, slippage: 0.2 },
  XAU_USD: { spread: 0.3, slippage: 0.2 },
  "XAG/USD": { spread: 0.025, slippage: 0.015 },
  XAG_USD: { spread: 0.025, slippage: 0.015 },
  // Energy
  "WTI Oil": { spread: 0.03, slippage: 0.02 },
  WTICO_USD: { spread: 0.03, slippage: 0.02 },
  // Indices
  NAS100: { spread: 1.8, slippage: 1.5 },
  NAS100_USD: { spread: 1.8, slippage: 1.5 },
  SPX500: { spread: 0.5, slippage: 0.4 },
  SPX500_USD: { spread: 0.5, slippage: 0.4 },
  US30: { spread: 2.5, slippage: 2.0 },
  US30_USD: { spread: 2.5, slippage: 2.0 },
  // FX majors
  "EUR/USD": { spread: 0.00012, slippage: 0.00008 },
  EUR_USD: { spread: 0.00012, slippage: 0.00008 },
  "GBP/USD": { spread: 0.00016, slippage: 0.0001 },
  GBP_USD: { spread: 0.00016, slippage: 0.0001 },
  "USD/JPY": { spread: 0.014, slippage: 0.01 },
  USD_JPY: { spread: 0.014, slippage: 0.01 },
  // Crypto
  "BTC/USD": { spread: 12, slippage: 10 },
  "ETH/USD": { spread: 1.2, slippage: 1.0 },
  "XRP/USD": { spread: 0.0012, slippage: 0.001 },
};

/**
 * Fallback for instruments with no measured table entry: 2 basis points of price
 * round turn, which is in the right area for a liquid CFD and errs high for FX.
 */
const FALLBACK_FRACTION = 0.0002;

/** Round-turn cost of one trade in price units (entry and exit combined). */
export function roundTripCost(symbol: string, price: number): number {
  const model = COSTS[symbol] ?? COSTS[symbol.replace("/", "_")];
  if (model) return model.spread + model.slippage;
  return Math.abs(price) * FALLBACK_FRACTION;
}

/** Whether this symbol has a measured cost model rather than the fallback. */
export function hasCostModel(symbol: string): boolean {
  return Boolean(COSTS[symbol] ?? COSTS[symbol.replace("/", "_")]);
}

/**
 * Cost of one trade expressed in R, given the risk distance (entry to stop).
 * This is the number that is not constant across grades: the tighter the stop,
 * the larger the share of R the same spread consumes.
 */
export function costInR(symbol: string, price: number, riskDistance: number): number {
  if (!(riskDistance > 0)) return 0;
  return Math.round((roundTripCost(symbol, price) / riskDistance) * 10000) / 10000;
}

/** Gross R minus the cost of trading it. */
export function netOfCosts(grossR: number, symbol: string, price: number, riskDistance: number): number {
  return Math.round((grossR - costInR(symbol, price, riskDistance)) * 1000) / 1000;
}
