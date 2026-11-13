// Shared auto-trading types + rail evaluation. Safe to import from client and server.
// Live only: every order goes to the trader's connected broker account.
import { instrumentReview } from "@/lib/instrument-review";
export type AutopilotMode = "manual" | "auto";

export type AutopilotSettings = {
  mode: AutopilotMode;
  /** "ALL" trades every real letter grade (A+ to D), never HOLD / NO ENTRY. */
  minGrade: "A+" | "A" | "B" | "ALL";
  riskPct: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  allowedSymbols: string[];
  sessionWindows: string[];
  liveAcknowledged: boolean;
  pausedReason: string | null;
  /** Which connected account real orders go to. */
  liveVenue: string;
  /** Move the stop to break-even once a filled trade is up by its own risk. */
  manageTrades: boolean;
  /** Close part of the position at the first target. */
  managePartials: boolean;
  /** Trail the remainder behind structure once the first target is paid. */
  trailAfterTp1: boolean;
  /** Refuse any order that would reach a real-money account (test runs). */
  demoOnly?: boolean;
  /** Size every trade as if the account held this balance; null uses the broker balance. */
  sizingBalance?: number | null;
};

export const DEFAULT_AUTOPILOT_SETTINGS: AutopilotSettings = {
  mode: "manual",
  minGrade: "A",
  riskPct: 0.5,
  maxOpenPositions: 2,
  maxDailyLossPct: 3,
  allowedSymbols: ["XAU/USD", "EUR/USD", "NAS100", "SPX500"],
  sessionWindows: ["london", "newyork"],
  liveAcknowledged: false,
  pausedReason: null,
  liveVenue: "oanda",
  manageTrades: true,
  managePartials: true,
  trailAfterTp1: true,
  sizingBalance: 500,
};

// Only real letter grades carry a rank. Anything else - null, undefined, the
// strings "null"/"undefined", HOLD, NO ENTRY, an empty string - is not a grade
// and can never clear the minimum-grade rail. Fail closed, explicitly.
const GRADE_RANK: Record<string, number> = { "A+": 4, A: 3, B: 2, C: 1, D: 0 };

/** Balance used for position sizing: the override when set, else the broker equity. */
export function sizingEquity(brokerEquity: number, sizingBalance: number | null | undefined): number {
  if (sizingBalance != null && Number.isFinite(sizingBalance) && sizingBalance > 0) return sizingBalance;
  return brokerEquity;
}

/** C (and D) trades are taken for data only, at no more than this % risk. */
export const LOW_GRADE_MAX_RISK_PCT = 0.25;

/** Risk for one trade: C/D grades are capped at LOW_GRADE_MAX_RISK_PCT; a C stays a C. */
export function autopilotRiskPct(riskPct: number, grade: string | null | undefined): number {
  const g = typeof grade === "string" ? grade.trim().toUpperCase() : "";
  return g === "C" || g === "D" ? Math.min(riskPct, LOW_GRADE_MAX_RISK_PCT) : riskPct;
}

/** Forex pairs: alert-only until settled results justify auto trading (stops too small for costs). */
export function isForexPair(symbol: string): boolean {
  return /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol.trim().toUpperCase()) && !/^(XAU|XAG|XPT|XPD|BTC|ETH)\//.test(symbol.trim().toUpperCase());
}

/** Crypto has no reliable feed yet, so it is never auto traded. */
export function isCryptoWithoutFeed(symbol: string): boolean {
  return /^(BTC|ETH)/.test(symbol.trim().toUpperCase().replace(/[^A-Z]/g, ""));
}

export function gradeMeets(grade: string | null | undefined, minGrade: string | null | undefined): boolean {
  if (typeof grade !== "string" || typeof minGrade !== "string") return false;
  const g = GRADE_RANK[grade.trim().toUpperCase()];
  const minKey = minGrade.trim().toUpperCase();
  const min = minKey === "ALL" ? 0 : GRADE_RANK[minKey];
  // Unknown grade or unknown minimum: refuse rather than guess.
  if (g === undefined || min === undefined) return false;
  return g >= min;
}

export function evaluateRails(
  settings: AutopilotSettings,
  candidate: {
    symbol: string;
    grade: string | null;
    openPositions: number;
    /** Open broker positions on this same symbol. */
    openOnSymbol?: number;
    dailyLossPct?: number;
    /** Sweep-gate state. Only ACTIVE (or unset) may execute; HOLD/ARMED/INVALIDATED never do. */
    gateState?: string | null;
    /** Fix 4 counter-bias reversal: internal only, never auto-executed. */
    counterBiasReversal?: boolean;
  },
): { allowed: boolean; reason: string | null } {
  if (candidate.gateState != null && candidate.gateState !== "ACTIVE") {
    return { allowed: false, reason: `Setup is ${candidate.gateState}, not an active entry` };
  }
  if (candidate.counterBiasReversal) {
    return { allowed: false, reason: "Counter-bias reversals are not traded automatically" };
  }
  if (candidate.dailyLossPct !== undefined && candidate.dailyLossPct >= settings.maxDailyLossPct) {
    return {
      allowed: false,
      reason: `Down ${candidate.dailyLossPct}% today, at or past your ${settings.maxDailyLossPct}% daily loss cap`,
    };
  }
  if (settings.pausedReason) {
    return { allowed: false, reason: `Auto trading paused: ${settings.pausedReason}` };
  }
  if (!settings.liveAcknowledged) {
    return { allowed: false, reason: "Live execution has not been acknowledged" };
  }
  if (settings.allowedSymbols.length > 0 && !settings.allowedSymbols.includes(candidate.symbol)) {
    return { allowed: false, reason: `${candidate.symbol} is not on your allowed symbol list` };
  }
  if (isCryptoWithoutFeed(candidate.symbol)) {
    return { allowed: false, reason: `${candidate.symbol} is off the auto list until a reliable price feed is connected` };
  }
  const review = instrumentReview(candidate.symbol);
  if (review) {
    return { allowed: false, reason: `${review.symbol} is under review and cannot be traded automatically` };
  }
  if (!gradeMeets(candidate.grade, settings.minGrade)) {
    return {
      allowed: false,
      reason: `Grade ${candidate.grade ?? "unknown"} is below your ${settings.minGrade} minimum`,
    };
  }
  // No account-wide position cap: one stacked pair must never lock out other
  // instruments. Only same-symbol stacking is limited.
  if ((candidate.openOnSymbol ?? 0) >= MAX_POSITIONS_PER_SYMBOL) {
    return { allowed: false, reason: `Already ${MAX_POSITIONS_PER_SYMBOL} open ${candidate.symbol} positions` };
  }
  return { allowed: true, reason: null };
}

export const MODE_COPY: Record<AutopilotMode, { label: string; detail: string }> = {
  manual: {
    label: "Manual",
    detail: "The coach writes the plan. Nothing reaches your broker unless you place it yourself.",
  },
  auto: {
    label: "Auto",
    detail:
      "When a scan comes back at or above your minimum grade, you get asked whether to place it. Approved trades go to your connected account with the stop and target attached, and are managed from there.",
  },
};

/** Most open positions Autopilot will hold on one symbol at a time. */
export const MAX_POSITIONS_PER_SYMBOL = 2;
