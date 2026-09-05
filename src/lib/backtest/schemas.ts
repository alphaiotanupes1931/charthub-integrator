// Client-safe validators shared by the backtest server functions.
// Kept out of *.functions.ts so the server-function splitter cannot strip them.
import { z } from "zod";
import { BACKTEST_TIMEFRAMES } from "./catalog";

export const BacktestInput = z.object({
  symbol: z.string().min(1),
  timeframe: z.enum(BACKTEST_TIMEFRAMES),
  lookback: z.enum(["60d", "1y", "2y", "5y"]).default("2y"),
  minGrade: z.enum(["A+", "A", "B", "C"]).default("B"),
  direction: z.enum(["both", "long", "short"]).default("both"),
  riskPct: z.coerce.number().min(0.1).max(10).default(1),
  rrTarget: z.coerce.number().min(0.5).max(10).default(1.5),
  atrStopMult: z.coerce.number().min(0.3).max(5).default(1.5),
  maxHoldBars: z.coerce.number().int().min(3).max(300).default(40),
  sessions: z.array(z.string()).default([]),
});

export const StrategyPerfInput = z.object({
  strategyId: z.string().min(1).max(80),
  symbol: z.string().min(1).max(20),
  timeframe: z.enum(BACKTEST_TIMEFRAMES),
  lookback: z.enum(["60d", "1y", "2y", "5y"]).default("2y"),
  minGrade: z.enum(["A+", "A", "B", "C"]).default("B"),
  direction: z.enum(["both", "long", "short"]).default("both"),
});
