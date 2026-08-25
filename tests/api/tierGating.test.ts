// Tier gating matrix, driven through real Stripe webhook syncs.
// For each tier we push a subscription event through the sync layer, read the
// resulting row exactly like the app does, and assert Analytics, grade quotas,
// journal, academy and coach access all match the spec.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  resolveEntitlements,
  quotaView,
  quotaLabel,
  academyModuleAllowed,
  coachAllowed,
  can,
  FREE_GRADES_PER_MONTH,
  type SubscriptionState,
} from "../../src/lib/entitlements";

type Row = Record<string, unknown>;

const db = { subscriptions: new Map<string, Row>() };

function table(name: string) {
  if (name !== "subscriptions") throw new Error(`unexpected table ${name}`);
  return {
    select: () => ({
      eq: (_c: string, userId: string) => ({
        maybeSingle: async () => ({ data: db.subscriptions.get(userId) ?? null }),
      }),
    }),
    upsert: async (row: Row) => {
      const userId = row["user_id"] as string;
      db.subscriptions.set(userId, { ...(db.subscriptions.get(userId) ?? {}), ...row });
      return { error: null };
    },
  };
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => table(name),
    auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } },
  },
}));

const { syncSubscription } = await import("../../src/lib/stripe-sync.server");

const PRICES = {
  basic: { lookup_key: "trademind_basic_monthly_v1" },
  pro: { lookup_key: "trademind_pro_monthly_v1" },
  elite: { lookup_key: "trademind_elite_monthly_v1" },
};
const HOUR = 3600;
const NOW = Math.floor(Date.UTC(2026, 7, 22) / 1000);

function stripeSub(status: string, tier?: keyof typeof PRICES) {
  return {
    id: "sub_1",
    status,
    customer: "cus_1",
    metadata: { user_id: "user_1" },
    cancel_at_period_end: false,
    trial_end: null,
    current_period_end: NOW + 30 * 24 * HOUR,
    items: { data: tier ? [{ price: PRICES[tier] }] : [] },
  } as never;
}

function entitlements(isAdmin = false) {
  const row = db.subscriptions.get("user_1");
  const subscription: SubscriptionState | null = row
    ? {
        status: (row["status"] as string) ?? null,
        tier: (row["tier"] as string) ?? null,
        trialEnd: (row["trial_end"] as string) ?? null,
      }
    : null;
  return resolveEntitlements({ flagEnabled: true, subscription, isAdmin, now: new Date(NOW * 1000) });
}

/** Sends an "active" webhook for the tier, or nothing at all for free. */
async function asTier(tier: keyof typeof PRICES | "free") {
  db.subscriptions.clear();
  if (tier !== "free") await syncSubscription(stripeSub("active", tier), NOW);
  return entitlements();
}

beforeEach(() => db.subscriptions.clear());

describe("analytics gating per tier", () => {
  it("blocks Analytics on free and unlocks it from Basic up", async () => {
    expect(can(await asTier("free"), "analytics")).toBe(false);
    for (const tier of ["basic", "pro", "elite"] as const) {
      expect(can(await asTier(tier), "analytics")).toBe(true);
    }
  });

  it("keeps pro-only intelligence surfaces off Basic", async () => {
    const basic = await asTier("basic");
    expect(can(basic, "signal_engine")).toBe(false);
    expect(can(basic, "trading_memory")).toBe(false);
    expect(can(basic, "briefings")).toBe(false);

    const pro = await asTier("pro");
    expect(can(pro, "signal_engine")).toBe(true);
    expect(can(pro, "trading_memory")).toBe(true);
    expect(can(pro, "briefings")).toBe(true);
    expect(can(pro, "broker_live")).toBe(false);
    expect(can(pro, "autopilot")).toBe(false);

    const elite = await asTier("elite");
    expect(can(elite, "broker_live")).toBe(true);
    expect(can(elite, "autopilot")).toBe(true);
  });
});

describe("grade quota per tier", () => {
  it("caps free at 3 grades a month with a visible counter", async () => {
    const free = await asTier("free");
    expect(free.gradeLimit).toBe(FREE_GRADES_PER_MONTH);
    const fresh = quotaView(free, 0);
    expect(fresh).toMatchObject({ active: true, used: 0, remaining: 3, exhausted: false });
    expect(quotaLabel(fresh)).toBe("3 of 3 grades left this month");
    expect(quotaView(free, 2)).toMatchObject({ remaining: 1, exhausted: false });
    expect(quotaView(free, 3).exhausted).toBe(true);
    // Overshoot from a race can never report a negative balance.
    expect(quotaView(free, 9)).toMatchObject({ used: 3, remaining: 0, exhausted: true });
  });

  it("removes the quota entirely on every paid tier", async () => {
    for (const tier of ["basic", "pro", "elite"] as const) {
      const ent = await asTier(tier);
      expect(ent.gradeLimit).toBeNull();
      expect(can(ent, "unlimited_grades")).toBe(true);
      const view = quotaView(ent, 50);
      expect(view.active).toBe(false);
      expect(view.exhausted).toBe(false);
      expect(quotaLabel(view)).toBeNull();
    }
  });

  it("restores the quota when a webhook cancels the subscription", async () => {
    await asTier("pro");
    await syncSubscription(stripeSub("canceled", "pro"), NOW + 60);
    const ent = entitlements();
    expect(ent.tier).toBe("free");
    expect(quotaView(ent, 0)).toMatchObject({ active: true, limit: 3 });
  });

  it("does not re-impose the quota during past_due retries", async () => {
    db.subscriptions.clear();
    await syncSubscription(stripeSub("past_due", "pro"), NOW);
    const ent = entitlements();
    expect(ent.gradeLimit).toBeNull();
    expect(quotaView(ent, 5).active).toBe(false);
  });
});

describe("journal and academy gating per tier", () => {
  it("keeps journal, risk calculator, alerts and flashcards free forever", async () => {
    for (const tier of ["free", "basic", "pro", "elite"] as const) {
      const ent = await asTier(tier);
      for (const cap of ["journal", "risk_calculator", "price_alerts", "flashcards", "community"] as const) {
        expect(can(ent, cap)).toBe(true);
      }
    }
  });

  it("limits free accounts to the first three academy modules", async () => {
    const free = await asTier("free");
    expect(can(free, "academy_basics")).toBe(true);
    expect(can(free, "academy_all")).toBe(false);
    expect(academyModuleAllowed(free, 1)).toBe(true);
    expect(academyModuleAllowed(free, 3)).toBe(true);
    expect(academyModuleAllowed(free, 4)).toBe(false);
    expect(academyModuleAllowed(free, 12)).toBe(false);
  });

  it("unlocks the whole academy from Basic up", async () => {
    for (const tier of ["basic", "pro", "elite"] as const) {
      const ent = await asTier(tier);
      expect(can(ent, "academy_all")).toBe(true);
      expect(academyModuleAllowed(ent, 12)).toBe(true);
    }
  });

  it("re-locks paid academy modules after a cancellation webhook", async () => {
    await asTier("elite");
    expect(academyModuleAllowed(entitlements(), 9)).toBe(true);
    await syncSubscription(stripeSub("canceled", "elite"), NOW + 60);
    expect(academyModuleAllowed(entitlements(), 9)).toBe(false);
    // Basics stay open so nothing the spec calls free-forever disappears.
    expect(academyModuleAllowed(entitlements(), 2)).toBe(true);
  });
});

describe("coach allowance per tier", () => {
  it("gives free one coach, Basic two, Pro and Elite all six", async () => {
    const free = await asTier("free");
    expect(free.coachAllowance).toBe(1);
    expect(coachAllowed(free, "The Analyst")).toBe(true);
    expect(coachAllowed(free, "The Strategist")).toBe(false);

    const basic = await asTier("basic");
    expect(basic.coachAllowance).toBe(2);
    expect(coachAllowed(basic, "The Strategist")).toBe(true);
    expect(coachAllowed(basic, "The Disciplinarian")).toBe(false);

    for (const tier of ["pro", "elite"] as const) {
      const ent = await asTier(tier);
      expect(coachAllowed(ent, "The Psychologist")).toBe(true);
    }
  });
});

describe("admin override", () => {
  it("keeps admins on full access with no quota regardless of Stripe state", async () => {
    await asTier("free");
    const ent = entitlements(true);
    expect(ent.tier).toBe("elite");
    expect(ent.gradeLimit).toBeNull();
    expect(quotaView(ent, 99).active).toBe(false);
    expect(can(ent, "analytics")).toBe(true);
    expect(can(ent, "autopilot")).toBe(true);
  });
});
