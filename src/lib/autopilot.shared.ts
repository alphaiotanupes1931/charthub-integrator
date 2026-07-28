// Shared autopilot types + rail evaluation. Safe to import from client and server.
export type AutopilotMode = "manual" | "confirm" | "auto";

export type AutopilotSettings = {
  mode: AutopilotMode;
  accountTarget: "paper" | "live";
  minGrade: "A+" | "A" | "B";
  riskPct: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  allowedSymbols: string[];
  sessionWindows: string[];
  liveAcknowledged: boolean;
  pausedReason: string | null;
};

export const DEFAULT_AUTOPILOT_SETTINGS: AutopilotSettings = {
  mode: "manual",
  accountTarget: "paper",
  minGrade: "A",
  riskPct: 0.5,
  maxOpenPositions: 2,
  maxDailyLossPct: 3,
  allowedSymbols: ["XAU/USD", "EUR/USD", "NAS100", "SPX500"],
  sessionWindows: ["london", "newyork"],
  liveAcknowledged: false,
  pausedReason: null,
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
  candidate: { symbol: string; grade: string | null; openPositions: number },
): { allowed: boolean; reason: string | null } {
  if (settings.pausedReason) {
    return { allowed: false, reason: `Autopilot paused: ${settings.pausedReason}` };
  }
  if (settings.accountTarget === "live" && !settings.liveAcknowledged) {
    return { allowed: false, reason: "Live execution has not been acknowledged" };
  }
  if (settings.allowedSymbols.length > 0 && !settings.allowedSymbols.includes(candidate.symbol)) {
    return { allowed: false, reason: `${candidate.symbol} is not on your allowed symbol list` };
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
  confirm: {
    label: "Confirm",
    detail: "The coach proposes a trade and it waits here for your approval. Proposals expire after 15 minutes.",
  },
  auto: {
    label: "Auto",
    detail: "Proposals that clear every rail below execute on their own. Everything is still logged here.",
  },
};
