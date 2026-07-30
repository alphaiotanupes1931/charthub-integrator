// Shared types for the 3-layer agent stack:
//   L1 Data  → MarketSnapshot
//   L2 Research → AnalystNote[] + ResearchMemo
//   L3 Planner → TradePlan

export type Candle = { time: number; open: number; high: number; low: number; close: number };

export type MarketSnapshot = {
  ticker: string;
  interval: string;
  source: "yahoo" | "coingecko" | "backup" | "unavailable";
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
};
