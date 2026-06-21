export type Level = "Beginner" | "Intermediate" | "Advanced";
export type Style = "Day" | "Swing" | "Scalp";

export interface Strategy {
  name: string;
  level: Level;
  style: Style;
  markets: string[];
  description: string;
  winRate: number;
  rr: number;
}

export const STRATEGIES: Strategy[] = [
  {
    name: "Breakout & Retest",
    level: "Beginner",
    style: "Day",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade confirmed breakouts of key support/resistance levels after they retest as new support or resistance. Simple, systematic…",
    winRate: 58,
    rr: 2.2,
  },
  {
    name: "EMA Crossover Trend",
    level: "Beginner",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Follow the trend using exponential moving average crossovers (9/21 EMA). A simple, systematic approach that captures the meat of…",
    winRate: 45,
    rr: 3.5,
  },
  {
    name: "Fibonacci Retracement",
    level: "Intermediate",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade pullbacks to key Fibonacci levels (38.2%, 50%, 61.8%) within established trends. Use the golden ratio to find high-probability entries wit…",
    winRate: 57,
    rr: 2.8,
  },
  {
    name: "Gap and Go",
    level: "Intermediate",
    style: "Scalp",
    markets: ["Stocks"],
    description: "Trade stocks that gap up or down at market open with high volume and momentum. Capture the continuation move as gap runners extend…",
    winRate: 55,
    rr: 2,
  },
  {
    name: "ICT Concepts",
    level: "Advanced",
    style: "Day",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade Order Blocks and Fair Value Gaps using institutional price delivery concepts. Focus on liquidity sweeps and market structure shifts for…",
    winRate: 55,
    rr: 3.8,
  },
  {
    name: "Mean Reversion (Bollinger…)",
    level: "Beginner",
    style: "Scalp",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade price extremes using Bollinger Bands to identify oversold and overbought conditions. Buy at the lower band, sell at the upper band,…",
    winRate: 68,
    rr: 1.5,
  },
  {
    name: "Supply & Demand Zones",
    level: "Intermediate",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Identify institutional supply and demand zones from price action and trade reactions off them. Reliable in any market.",
    winRate: 62,
    rr: 2.5,
  },
  {
    name: "Turtle Trading",
    level: "Advanced",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "The legendary trend-following system that uses 20/55-day breakouts and ATR-based position sizing.",
    winRate: 42,
    rr: 4,
  },
  {
    name: "VWAP Trading",
    level: "Intermediate",
    style: "Day",
    markets: ["Stocks", "Forex"],
    description: "Use Volume Weighted Average Price as dynamic support and resistance for intraday momentum entries.",
    winRate: 60,
    rr: 2.1,
  },
];
