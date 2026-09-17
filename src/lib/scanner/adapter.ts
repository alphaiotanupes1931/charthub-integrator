/**
 * Maps the planner's existing measured state onto the Scanner Program v1 input.
 *
 * Pure and explicit on purpose: nothing here re-measures the market, so the
 * program can never disagree with the planner about what the data said. It only
 * disagrees about what that data is worth.
 */

import { costInR } from "@/lib/trading-costs";
import type { ProgramInput } from "@/lib/scanner/score";

export type AdapterArgs = {
  symbol: string;
  timeframe: string;
  bias: "Long" | "Short";
  at?: Date;
  lastPrice: number;
  entry: number;
  stop: number;
  tp1: number;
  ladder: Array<{ label: string; bias?: string | undefined; trend?: string | undefined }>;
  h4Direction?: string | undefined;
  h4Trend?: string | undefined;
  h1StructureBreak?: string | undefined;
  m15Confirmation?: string | undefined;
  cisdState?: string | undefined;
  closed4hCandles?: number | undefined;
  entryZoneQuality?: number | null | undefined;
  hasOrderBlock?: boolean | undefined;
  hasFvg?: boolean | undefined;
  hasHtfZone?: boolean | undefined;
  protectedBreak?: boolean | null | undefined;
  sweptLiquidity?: boolean | undefined;
  displacement?: boolean | undefined;
  cvd?: number | null | undefined;
  delta?: number | null | undefined;
  priceVsPoc?: string | null | undefined;
  volumeRatio?: number | null | undefined;
  thinVolume?: boolean | undefined;
  newsInHoldWindow?: boolean | undefined;
  news48h?: boolean | undefined;
  staleHtf?: boolean | undefined;
  triggered?: boolean | undefined;
  targetRoomOk?: boolean | undefined;
};

export function toProgramInput(a: AdapterArgs): ProgramInput {
  const risk = Math.abs(a.entry - a.stop);
  const rr = risk > 0 ? Math.abs(a.tp1 - a.entry) / risk : 0;
  const costR = risk > 0 ? costInR(a.symbol, a.lastPrice || a.entry, risk) : 0.05;
  // Cost as a share of what the trade is expected to make, which is the number
  // the cost veto is written against, not the raw spread.
  const grossR = Math.max(0.05, rr * 0.5 - 0.5);
  return {
    symbol: a.symbol,
    timeframe: a.timeframe,
    at: a.at ?? new Date(),
    wantBull: a.bias === "Long",
    ladder: a.ladder,
    h4Direction: a.h4Direction,
    h4Trend: a.h4Trend,
    cisdState: a.cisdState,
    closed4hCandles: a.closed4hCandles,
    entryZoneQuality: a.entryZoneQuality,
    hasOrderBlock: a.hasOrderBlock,
    hasFvg: a.hasFvg,
    hasHtfZone: a.hasHtfZone,
    protectedBreak: a.protectedBreak,
    h1StructureBreak: a.h1StructureBreak,
    m15Confirmation: a.m15Confirmation,
    sweptLiquidity: a.sweptLiquidity,
    displacement: a.displacement,
    cvd: a.cvd,
    delta: a.delta,
    priceVsPoc: a.priceVsPoc,
    volumeRatio: a.volumeRatio,
    costShare: Math.min(1, costR / grossR),
    thinVolume: a.thinVolume,
    newsInHoldWindow: a.newsInHoldWindow,
    news48h: a.news48h,
    staleHtf: a.staleHtf,
    plannedRR: rr,
    targetRoomOk: a.targetRoomOk,
  };
}
