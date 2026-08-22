import { describe, expect, it } from "vitest";
import {
  FREE_GRADES_PER_MONTH,
  can,
  isCacheFresh,
  monthKey,
  quotaLabel,
  quotaView,
  resolveEntitlements,
  scanCacheKey,
  shouldConsumeGrade,
} from "@/lib/entitlements";

const NOW = new Date("2026-08-22T12:00:00Z");

const paid = (tier: "basic" | "pro" | "elite") => ({ status: "active", tier, trialEnd: null });

describe("§7 migration — paid accounts are untouched", () => {
  it("keeps every paid tier out of the free tier entirely", () => {
    for (const tier of ["basic", "pro", "elite"] as const) {
      const ent = resolveEntitlements({ flagEnabled: true, subscription: paid(tier), now: NOW });
      expect(ent.tier).toBe(tier);
      expect(ent.isPaid).toBe(true);
      expect(ent.freeTierActive).toBe(false);
      expect(ent.gradeLimit).toBeNull();
      expect(can(ent, "unlimited_grades")).toBe(true);
      expect(can(ent, "analytics")).toBe(true);
      // No quota UI and no paywall can render without an active quota.
      expect(quotaView(ent, 99).active).toBe(false);
      expect(quotaLabel(quotaView(ent, 99))).toBeNull();
    }
  });

  it("a past_due paid account is not demoted to free", () => {
    const ent = resolveEntitlements({
      flagEnabled: true,
      subscription: { status: "past_due", tier: "pro", trialEnd: null },
      now: NOW,
    });
    expect(ent.freeTierActive).toBe(false);
    expect(ent.tier).toBe("pro");
  });

  it("admins are never gated", () => {
    const ent = resolveEntitlements({ flagEnabled: true, subscription: null, isAdmin: true, now: NOW });
    expect(ent.freeTierActive).toBe(false);
    expect(can(ent, "autopilot")).toBe(true);
  });

  it("a mid-trial account keeps full access until its original end date, then lands on free", () => {
    const midTrial = { status: "trialing", tier: "pro", trialEnd: "2026-08-25T00:00:00Z" };
    const during = resolveEntitlements({ flagEnabled: true, subscription: midTrial, now: NOW });
    expect(during.onLegacyTrial).toBe(true);
    expect(during.freeTierActive).toBe(false);
    expect(can(during, "analytics")).toBe(true);

    const after = resolveEntitlements({
      flagEnabled: true,
      subscription: midTrial,
      now: new Date("2026-08-26T00:00:01Z"),
    });
    expect(after.onLegacyTrial).toBe(false);
    expect(after.tier).toBe("free");
    expect(after.freeTierActive).toBe(true);
    expect(after.gradeLimit).toBe(FREE_GRADES_PER_MONTH);
  });

  it("an expired trial that never paid lands on free with a full 3 grades", () => {
    const ent = resolveEntitlements({
      flagEnabled: true,
      subscription: { status: "canceled", tier: null, trialEnd: "2026-07-01T00:00:00Z" },
      now: NOW,
    });
    expect(ent.tier).toBe("free");
    expect(quotaView(ent, 0)).toMatchObject({ used: 0, remaining: 3, exhausted: false });
  });

  it("a brand-new account with no subscription row is free", () => {
    const ent = resolveEntitlements({ flagEnabled: true, subscription: null, now: NOW });
    expect(ent.tier).toBe("free");
    expect(ent.freeTierActive).toBe(true);
  });
});

describe("feature flag off restores previous behaviour", () => {
  it("no quota, no free tier, for free and paid alike", () => {
    const anon = resolveEntitlements({ flagEnabled: false, subscription: null, now: NOW });
    expect(anon.freeTierActive).toBe(false);
    expect(anon.gradeLimit).toBeNull();
    expect(can(anon, "analytics")).toBe(true);

    const payer = resolveEntitlements({ flagEnabled: false, subscription: paid("basic"), now: NOW });
    expect(payer.freeTierActive).toBe(false);
    expect(payer.tier).toBe("basic");
  });
});

describe("§3 free tier capabilities", () => {
  const free = resolveEntitlements({ flagEnabled: true, subscription: null, now: NOW });

  it("keeps journal, calculator, alerts, Academy basics, flashcards and community free", () => {
    for (const cap of ["journal", "risk_calculator", "price_alerts", "academy_basics", "flashcards", "community"] as const) {
      expect(can(free, cap)).toBe(true);
    }
  });

  it("holds the paid layer back", () => {
    for (const cap of [
      "unlimited_grades",
      "analytics",
      "signal_engine",
      "strategy_library",
      "trading_memory",
      "briefings",
      "broker_paper",
      "broker_live",
      "autopilot",
      "academy_all",
    ] as const) {
      expect(can(free, cap)).toBe(false);
    }
  });

  it("gives free one coach, basic two, pro and elite all five", () => {
    expect(free.coachAllowance).toBe(1);
    expect(resolveEntitlements({ flagEnabled: true, subscription: paid("basic"), now: NOW }).coachAllowance).toBe(2);
    expect(resolveEntitlements({ flagEnabled: true, subscription: paid("pro"), now: NOW }).coachAllowance).toBe(5);
    expect(resolveEntitlements({ flagEnabled: true, subscription: paid("elite"), now: NOW }).coachAllowance).toBe(5);
  });

  it("basic keeps Analytics but not the Pro-only surfaces", () => {
    const basic = resolveEntitlements({ flagEnabled: true, subscription: paid("basic"), now: NOW });
    expect(can(basic, "analytics")).toBe(true);
    expect(can(basic, "signal_engine")).toBe(false);
    expect(can(basic, "autopilot")).toBe(false);
  });

  it("only elite gets live broker access and autopilot", () => {
    const pro = resolveEntitlements({ flagEnabled: true, subscription: paid("pro"), now: NOW });
    expect(can(pro, "broker_paper")).toBe(true);
    expect(can(pro, "broker_live")).toBe(false);
    expect(can(pro, "autopilot")).toBe(false);
    const elite = resolveEntitlements({ flagEnabled: true, subscription: paid("elite"), now: NOW });
    expect(can(elite, "broker_live")).toBe(true);
    expect(can(elite, "autopilot")).toBe(true);
  });
});

describe("§4 quota mechanics", () => {
  const free = resolveEntitlements({ flagEnabled: true, subscription: null, now: NOW });

  it("counts down from the first grade and shows the remaining count", () => {
    expect(quotaLabel(quotaView(free, 0))).toBe("3 of 3 grades left this month");
    expect(quotaLabel(quotaView(free, 1))).toBe("2 of 3 grades left this month");
    expect(quotaLabel(quotaView(free, 3))).toBe("0 of 3 grades left this month");
  });

  it("marks the account exhausted at the limit and clamps overshoot", () => {
    expect(quotaView(free, 2).exhausted).toBe(false);
    expect(quotaView(free, 3).exhausted).toBe(true);
    expect(quotaView(free, 9)).toMatchObject({ used: 3, remaining: 0, exhausted: true });
  });

  it("charges a grade for a real answer, including a legitimate No Entry", () => {
    expect(shouldConsumeGrade({ kind: "graded" })).toBe(true);
    expect(shouldConsumeGrade({ kind: "no_entry" })).toBe(true);
  });

  it("never charges for our own failures or a cached repeat", () => {
    for (const kind of ["error", "timeout", "no_result", "cached"] as const) {
      expect(shouldConsumeGrade({ kind })).toBe(false);
    }
  });

  it("treats instrument + timeframe + methodology as the debounce identity", () => {
    const a = scanCacheKey({ symbol: "xau/usd", timeframe: "15M", methodology: "Wyckoff" });
    expect(scanCacheKey({ symbol: "XAU/USD", timeframe: "15m", methodology: "wyckoff" })).toBe(a);
    expect(scanCacheKey({ symbol: "XAU/USD", timeframe: "1h", methodology: "wyckoff" })).not.toBe(a);
    expect(scanCacheKey({ symbol: "EUR/USD", timeframe: "15m", methodology: "wyckoff" })).not.toBe(a);
    expect(scanCacheKey({ symbol: "XAU/USD", timeframe: "15m", methodology: "smc" })).not.toBe(a);
    // Methodology defaults so an omitted value still matches itself.
    expect(scanCacheKey({ symbol: "XAU/USD", timeframe: "15m" })).toBe(a);
  });

  it("holds the cache for ten minutes and no longer", () => {
    const base = new Date("2026-08-22T12:00:00Z");
    expect(isCacheFresh(base, new Date("2026-08-22T12:09:59Z"))).toBe(true);
    expect(isCacheFresh(base, new Date("2026-08-22T12:10:01Z"))).toBe(false);
    expect(isCacheFresh("not-a-date")).toBe(false);
  });

  it("resets on the 1st in the account timezone, not UTC", () => {
    // 2026-09-01 00:30 in New York is still 2026-08-31 in UTC terms of date,
    // but the account's month has already rolled over.
    const rollover = new Date("2026-09-01T04:30:00Z");
    expect(monthKey("America/New_York", rollover)).toBe("2026-09");
    // And just before local midnight it is still August for that account.
    expect(monthKey("America/New_York", new Date("2026-09-01T03:30:00Z"))).toBe("2026-08");
    expect(monthKey("UTC", rollover)).toBe("2026-09");
  });

  it("falls back to UTC when the timezone is missing or bogus", () => {
    expect(monthKey(null, NOW)).toBe("2026-08");
    expect(monthKey("Not/AZone", NOW)).toBe("2026-08");
  });
});
