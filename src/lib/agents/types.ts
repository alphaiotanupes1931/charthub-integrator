// Shared types for the 3-layer agent stack:
//   L1 Data  → MarketSnapshot
//   L2 Research → AnalystNote[] + ResearchMemo
//   L3 Planner → TradePlan

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

/** Real order-flow metrics derived from OHLCV. See order-flow.server.ts. */
export type OrderFlow = {
  /** True when the feed supplied no volume and it was estimated from bar range. */
  estimated: boolean;
  bars: number;
  delta: number;
  deltaAvg: number;
  cvd: number;
  cvdSlope: number;
  poc: number;
  valueAreaLow: number;
  valueAreaHigh: number;
  priceVsPoc: "above" | "below" | "at";
  buyPct: number;
  imbalanceSkew: number;
  stackedImbalances: number;
  stackedSide: "buy" | "sell" | "none";
  depth: "thin" | "normal" | "deep" | "absorbing";
  lastVolRatio: number;
  bias: "bullish" | "bearish" | "neutral";
  /**
   * True when the most recent bar's delta points the opposite way to the
   * cumulative read (e.g. CVD rising while the live bar sells off hard). The
   * flow is then not confirming anything, so it cannot back a high grade.
   */
  deltaConflict: boolean;
};

export type MarketSnapshot = {
  ticker: string;
  interval: string;
  source: "oanda" | "yahoo" | "coingecko" | "twelvedata" | "binance" | "cached" | "backup" | "unavailable";
  lastPrice: number;
  candles: Candle[];
  stats: {
    high20: number;
    low20: number;
    high50: number;
    low50: number;
    atr14: number;
    changePct24h: number;
    range20Pct: number;
  };
  cisd: {
    state: "bullish" | "bearish" | "none";
    level: number;
    trigger: number;
    proj1: number;
    proj2: number;
    htfBias: "bullish" | "bearish" | "neutral";
  };
  sessionsActive: string[];
  fetchedAt: string;
  mtf?: MtfContext;
  orderFlow?: OrderFlow;
  /** Closed 4H candles, the anchor series the bias engine reads. */
  candles4h?: Candle[];
  /** ATR(14) of the 4H series, used for every ATR gate in the bias engine. */
  atr4h?: number;
};

// Multi-timeframe context (4H → 1H → 15m cascade).
// 4H sets direction/trend/key levels/S&D. 1H reads structure (breaks, reversal,
// OB, FVG, liquidity). 15m confirms entry.
export type MtfContext = {
  h4: {
    direction: "bullish" | "bearish" | "neutral";
    trend: "up" | "down" | "range";
    keyLevels: { support: number[]; resistance: number[] };
    supplyDemand: { supply: [number, number][]; demand: [number, number][] };
  };
  h1: {
    structureBreak: "bullish" | "bearish" | "none";
    reversal: "bullish" | "bearish" | "none";
    orderBlocks: { bull: [number, number][]; bear: [number, number][] };
    fvg: { bull: [number, number][]; bear: [number, number][] };
    liquidity: { buyside: number[]; sellside: number[] };
  };
  m15: {
    confirmation: "bullish" | "bearish" | "none";
    reason: string;
  };
  alignment: "aligned-long" | "aligned-short" | "mixed" | "none";
  /** Full ladder: Monthly, Weekly, Daily, 4H, 1H, 15m, 5m, 1m. */
  ladder?: TimeframeRead[];
};

/** One rung of the timeframe ladder. */
export type TimeframeRead = {
  label: "Monthly" | "Weekly" | "Daily" | "4H" | "1H" | "15m" | "5m" | "1m";
  interval: string;
  bias: "bullish" | "bearish" | "neutral";
  trend: "up" | "down" | "range";
  structure: "bullish" | "bearish" | "none";
  last: number;
  high: number;
  low: number;
  changePct: number;
  bars: number;
};

export type AnalystRole = "technical" | "macro" | "sentiment" | "risk";

export type AnalystNote = {
  role: AnalystRole;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number; // 0..100
  summary: string;    // one to three sentences
  keyLevels?: number[];
};

export type ResearchMemo = {
  ticker: string;
  interval: string;
  generatedAt: string;
  notes: AnalystNote[];
  consensus: "bullish" | "bearish" | "neutral";
  consensusConfidence: number;
};

export type TradePlan = {
  grade: "A+" | "A" | "B" | "C" | "NO ENTRY";
  bias: "Long" | "Short" | "Neutral";
  confidence: number;
  notes: string;
  entry: string;
  stop: string;
  tp1: string;
  tp2: string;
  rr: string;
  details: string;
  memo: ResearchMemo;
  /** Real order-flow metrics for the scanned instrument. */
  orderFlow?: OrderFlow;
  /** Daily bias for the day, from the Daily rung of the ladder. */
  dailyBias?: "bullish" | "bearish" | "neutral";
  /** Current trend, from the 4H rung - can disagree with daily bias. */
  currentTrend?: "up" | "down" | "range";
  /** Short plain-language synopsis of why this grade was given. */
  synopsis?: string;
  /** Provider and candle audit trail for this exact scan. */
  dataSource?: MarketSnapshot["source"];
  dataFetchedAt?: string;
  candleCount?: number;
  /** Market price this plan was measured against, at dataFetchedAt. */
  refPrice?: number;
  /** True when the setup fights the Daily and 4H direction. */
  counterTrend?: boolean;
  /** Higher-timeframe (Daily) bias at scan time. */
  htfBias?: "bullish" | "bearish" | "neutral";
  /** Session/execution warnings the trader must see (thin volume, mitigated block). */
  warnings?: string[];
  /** Session volume read for the last bar and the stop floor it produced. */
  sessionVolume?: {
    session: "Sydney" | "Tokyo" | "London" | "New York";
    /** last bar volume as a multiple of the session median */
    ratio: number;
    thin: boolean;
    label: string;
    /** minimum stop distance applied, in ATR multiples */
    stopAtr: number;
  };
  /** Set when the entry sits inside an order block price has already tested. */
  mitigatedEntry?: { mitigations: number; warning: string };
  /** Set when the platform chose the playbook from live market conditions. */
  autoStrategy?: { name: string; slug: string; regime: string; reason: string };

};
