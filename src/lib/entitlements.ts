// Single source of truth for what an account can do.
//
// Everything downstream (quota UI, paywall, Analytics preview, page gates) reads
// this one resolver so gating can't drift from page to page. Pure functions only:
// no network, no database, so the rules are directly testable.

export type Tier = "free" | "basic" | "pro" | "elite";

export const FREE_GRADES_PER_MONTH = 3;

/** Scan-result debounce window: an identical re-run inside this costs nothing. */
export const SCAN_DEBOUNCE_MS = 10 * 60 * 1000;

export type Capability =
  | "unlimited_grades"
  | "analytics"
  | "signal_engine"
  | "strategy_library"
  | "trading_memory"
  | "briefings"
  | "broker_paper"
  | "broker_live"
  | "autopilot"
  | "academy_all"
  | "journal"
  | "risk_calculator"
  | "price_alerts"
  | "academy_basics"
  | "flashcards"
  | "community";

/** Free forever, per §3: things that cost us nothing to give away. */
const ALWAYS_FREE: Capability[] = [
  "journal",
  "risk_calculator",
  "price_alerts",
  "academy_basics",
  "flashcards",
  "community",
];

const TIER_CAPABILITIES: Record<Tier, Capability[]> = {
  free: [...ALWAYS_FREE],
  basic: [...ALWAYS_FREE, "unlimited_grades", "analytics", "academy_all"],
  pro: [
    ...ALWAYS_FREE,
    "unlimited_grades",
    "analytics",
    "academy_all",
    "signal_engine",
    "strategy_library",
    "trading_memory",
    "briefings",
    "broker_paper",
  ],
  elite: [
    ...ALWAYS_FREE,
    "unlimited_grades",
    "analytics",
    "academy_all",
    "signal_engine",
    "strategy_library",
    "trading_memory",
    "briefings",
    "broker_paper",
    "broker_live",
    "autopilot",
  ],
};

/**
 * How many coaches each tier gets. The Basic count is a config value on purpose:
 * Marcus still owes us the number and which two (§13.1), so answering it is an
 * edit here, not a rewrite.
 */
export const COACH_ALLOWANCE: Record<Tier, number> = { free: 1, basic: 2, pro: 5, elite: 5 };
/** Free tier sees The Analyst only. */
export const FREE_COACH_IDS = ["analyst"];
/** Placeholder until §13.1 is answered — Basic keeps the Analyst plus one more. */
export const BASIC_COACH_IDS = ["analyst", "strategist"];
/** §13.2 recommendation: free users see Strategy Library titles, win rates hidden. */
export const FREE_SEES_STRATEGY_TITLES = true;

export type SubscriptionState = {
  /** Raw Stripe status, e.g. active | trialing | past_due | canceled | null. */
  status: string | null;
  tier: string | null;
  /** Original trial end date, when the account is/was on the 7-day trial. */
  trialEnd: string | null;
};

export type Entitlements = {
  tier: Tier;
  /** True while a legacy trial is still running — full access, untouched. */
  onLegacyTrial: boolean;
  isPaid: boolean;
  isAdmin: boolean;
  /** Free tier is only in effect once the flag is on. */
  freeTierActive: boolean;
  gradeLimit: number | null;
  capabilities: Capability[];
  coachAllowance: number;
};

function normalizeTier(raw: string | null | undefined): Tier | null {
  return raw === "basic" || raw === "pro" || raw === "elite" ? raw : null;
}

const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

export function resolveEntitlements(input: {
  flagEnabled: boolean;
  subscription: SubscriptionState | null;
  isAdmin?: boolean;
  now?: Date;
}): Entitlements {
  const { flagEnabled, subscription, isAdmin = false } = input;
  const now = input.now ?? new Date();

  const status = subscription?.status ?? null;
  const paidTier = normalizeTier(subscription?.tier);
  const trialEndsAt = subscription?.trialEnd ? new Date(subscription.trialEnd) : null;
  const trialStillRunning = !!trialEndsAt && trialEndsAt.getTime() > now.getTime();

  // A real subscription (or the trial that came with it) keeps everything it has
  // today. Checked before any free-tier logic so paid accounts never see quota
  // UI, a paywall, or a preview state — the highest-risk regression in §7.
  const isPaid = !!status && PAID_STATUSES.has(status) && (status !== "trialing" || !flagEnabled || trialStillRunning);

  if (isAdmin) {
    return {
      tier: "elite",
      onLegacyTrial: false,
      isPaid: true,
      isAdmin: true,
      freeTierActive: false,
      gradeLimit: null,
      capabilities: TIER_CAPABILITIES.elite,
      coachAllowance: COACH_ALLOWANCE.elite,
    };
  }

  // Flag off: behave exactly as before — everyone who isn't blocked today keeps
  // full access, so switching the flag off is a true rollback with no deploy.
  if (!flagEnabled) {
    const tier = paidTier ?? "elite";
    return {
      tier,
      onLegacyTrial: status === "trialing" && trialStillRunning,
      isPaid,
      isAdmin: false,
      freeTierActive: false,
      gradeLimit: null,
      capabilities: TIER_CAPABILITIES[tier],
      coachAllowance: COACH_ALLOWANCE[tier],
    };
  }

  // Mid-trial accounts finish their trial on their original end date (§7).
  if (status === "trialing" && trialStillRunning) {
    const tier = paidTier ?? "pro";
    return {
      tier,
      onLegacyTrial: true,
      isPaid: true,
      isAdmin: false,
      freeTierActive: false,
      gradeLimit: null,
      capabilities: TIER_CAPABILITIES[tier],
      coachAllowance: COACH_ALLOWANCE[tier],
    };
  }

  if (isPaid && paidTier) {
    return {
      tier: paidTier,
      onLegacyTrial: false,
      isPaid: true,
      isAdmin: false,
      freeTierActive: false,
      gradeLimit: null,
      capabilities: TIER_CAPABILITIES[paidTier],
      coachAllowance: COACH_ALLOWANCE[paidTier],
    };
  }

  // Everyone else — new signup, expired trial, cancelled — lands on Free.
  return {
    tier: "free",
    onLegacyTrial: false,
    isPaid: false,
    isAdmin: false,
    freeTierActive: true,
    gradeLimit: FREE_GRADES_PER_MONTH,
    capabilities: TIER_CAPABILITIES.free,
    coachAllowance: COACH_ALLOWANCE.free,
  };
}

export function can(ent: Entitlements, capability: Capability): boolean {
  return ent.capabilities.includes(capability);
}

/** Calendar month key in the account's timezone, e.g. "2026-08". UTC fallback. */
export function monthKey(timezone: string | null | undefined, at: Date = new Date()): string {
  const tz = timezone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(at);
    return parts.slice(0, 7);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit" }).format(at).slice(0, 7);
  }
}

export type QuotaView = {
  active: boolean;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
};

export function quotaView(ent: Entitlements, used: number): QuotaView {
  if (!ent.freeTierActive || ent.gradeLimit == null) {
    return { active: false, used: 0, limit: 0, remaining: Infinity, exhausted: false };
  }
  const limit = ent.gradeLimit;
  const clamped = Math.max(0, Math.min(used, limit));
  return {
    active: true,
    used: clamped,
    limit,
    remaining: limit - clamped,
    exhausted: clamped >= limit,
  };
}

/** "2 of 3 grades left this month" — shown from the first grade, not at the limit. */
export function quotaLabel(view: QuotaView): string | null {
  if (!view.active) return null;
  return `${view.remaining} of ${view.limit} grades left this month`;
}

/** Only a real, delivered answer costs a grade (§4). */
export type ScanOutcome =
  | { kind: "graded" }
  | { kind: "no_entry" }
  | { kind: "cached" }
  | { kind: "error" }
  | { kind: "timeout" }
  | { kind: "no_result" };

export function shouldConsumeGrade(outcome: ScanOutcome): boolean {
  return outcome.kind === "graded" || outcome.kind === "no_entry";
}

export function scanCacheKey(input: { symbol: string; timeframe: string; methodology?: string | null }): string {
  return [input.symbol.trim().toUpperCase(), input.timeframe.trim().toLowerCase(), (input.methodology ?? "wyckoff").trim().toLowerCase()].join("|");
}

export function isCacheFresh(createdAt: string | Date, now: Date = new Date()): boolean {
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < SCAN_DEBOUNCE_MS;
}

/** Academy basics per §3: modules 1-3 are free forever, the rest is paid. */
export const FREE_ACADEMY_MODULES = 3;

export function academyModuleAllowed(ent: Entitlements, moduleId: number): boolean {
  if (can(ent, "academy_all")) return true;
  return moduleId <= FREE_ACADEMY_MODULES;
}

/** Coach display names, in the order tiers unlock them. */
export const COACH_NAME_ORDER = [
  "The Analyst",
  "The Strategist",
  "The Disciplinarian",
  "The Mentor",
  "The Minimalist",
  "The Psychologist",
];

/** A tier gets the first N coaches in COACH_NAME_ORDER; unknown names are paid. */
export function coachAllowed(ent: Entitlements, coachName: string): boolean {
  if (!ent.freeTierActive && ent.coachAllowance >= COACH_NAME_ORDER.length) return true;
  const idx = COACH_NAME_ORDER.indexOf(coachName);
  if (idx === -1) return ent.coachAllowance >= COACH_NAME_ORDER.length;
  return idx < ent.coachAllowance;
}
