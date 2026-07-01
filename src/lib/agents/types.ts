// Shared types for the 3-layer agent stack:
//   L1 Data  → MarketSnapshot
//   L2 Research → AnalystNote[] + ResearchMemo
//   L3 Planner → TradePlan

export type Candle = { time: number; open: number; high: number; low: number; close: number };

export type MarketSnapshot = {
  ticker: string;
  interval: string;
  source: "yahoo" | "coingecko" | "unavailable";
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
