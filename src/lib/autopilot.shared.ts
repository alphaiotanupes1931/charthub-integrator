// Shared auto-trading types + rail evaluation. Safe to import from client and server.
// Live only: every order goes to the trader's connected broker account.
import { instrumentReview } from "@/lib/instrument-review";
export type AutopilotMode = "manual" | "auto";

export type AutopilotSettings = {
  mode: AutopilotMode;
  minGrade: "A+" | "A" | "B";
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
};

const GRADE_RANK: Record<string, number> = { "A+": 3, A: 2, B: 1, C: 0, D: 0, F: 0 };

export function gradeMeets(grade: string | null, minGrade: string): boolean {
  if (!grade) return false;
  const g = GRADE_RANK[grade.trim().toUpperCase()] ?? 0;
  const min = GRADE_RANK[minGrade.trim().toUpperCase()] ?? 2;
  return g >= min;
}

export function evaluateRails(
  settings: AutopilotSettings,
  candidate: { symbol: string; grade: string | null; openPositions: number; dailyLossPct?: number },
): { allowed: boolean; reason: string | null } {
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
  if (candidate.openPositions >= settings.maxOpenPositions) {
    return { allowed: false, reason: `Already at your ${settings.maxOpenPositions} open position limit` };
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
