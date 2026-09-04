// Integration tests: simulate Stripe checkout / portal callbacks (webhook events)
// end to end through the sync layer, then assert the resulting subscription row
// produces the right entitlements for free vs paid personas.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveEntitlements, type SubscriptionState } from "../../src/lib/entitlements";

type Row = Record<string, unknown>;

const db = {
  subscriptions: new Map<string, Row>(),
  events: new Map<string, Row>(),
};

function table(name: string) {
  if (name === "subscriptions") {
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
  if (name === "stripe_webhook_events") {
    return {
      insert: async (row: Row) => {
        const id = row["event_id"] as string;
        if (db.events.has(id)) return { error: { code: "23505" } };
        db.events.set(id, row);
        return { error: null };
      },
      delete: () => ({
        eq: async (_c: string, id: string) => {
          db.events.delete(id);
          return { error: null };
        },
      }),
    };
  }
  throw new Error(`unexpected table ${name}`);
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => table(name),
    auth: { admin: { listUsers: async () => ({ data: { users: customerUsers } }) } },
  },
}));

let customerUsers: Array<{ id: string; email: string }> = [];
const customers = new Map<string, { id: string; email?: string; metadata: Row }>();

vi.mock("@/lib/stripe.server", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/stripe.server")>(
    "../../src/lib/stripe.server",
  );
  return {
    ...actual,
    getStripe: () => ({
      customers: {
        retrieve: async (id: string) => customers.get(id),
        update: async (id: string, patch: { metadata: Row }) => {
          const c = customers.get(id)!;
          c.metadata = { ...c.metadata, ...patch.metadata };
          return c;
        },
      },
    }),
  };
});

const { syncSubscription, claimEvent, releaseEvent } = await import(
  "../../src/lib/stripe-sync.server"
);

const PRICES = {
  basic: { lookup_key: "trademind_basic_monthly_v1" },
  pro: { lookup_key: "trademind_pro_monthly_v1" },
  elite: { lookup_key: "trademind_elite_monthly_v1" },
};

const HOUR = 3600;
const NOW = Math.floor(Date.UTC(2026, 7, 22) / 1000);

function stripeSub(opts: {
  id?: string;
  status: string;
  tier?: keyof typeof PRICES;
  periodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
  trialEnd?: number | null;
  customer?: string;
  userId?: string | null;
}) {
  return {
    id: opts.id ?? "sub_1",
    status: opts.status,
    customer: opts.customer ?? "cus_1",
    metadata: opts.userId === null ? {} : { user_id: opts.userId ?? "user_1" },
    cancel_at_period_end: !!opts.cancelAtPeriodEnd,
    trial_end: opts.trialEnd ?? null,
    current_period_end: opts.periodEnd === undefined ? NOW + 30 * 24 * HOUR : opts.periodEnd,
    items: { data: opts.tier ? [{ price: PRICES[opts.tier] }] : [] },
  } as never;
}

function rowFor(userId: string) {
  return db.subscriptions.get(userId) ?? null;
}

/** Same shape the app reads: DB row -> entitlements resolver. */
function entitlementsFor(userId: string, isAdmin = false) {
  const row = rowFor(userId);
  const subscription: SubscriptionState | null = row
    ? {
        status: (row["status"] as string) ?? null,
        tier: (row["tier"] as string) ?? null,
        trialEnd: (row["trial_end"] as string) ?? null,
      }
    : null;
  return resolveEntitlements({
    flagEnabled: true,
    subscription,
    isAdmin,
    now: new Date(NOW * 1000),
  });
}

beforeEach(() => {
  db.subscriptions.clear();
  db.events.clear();
  customers.clear();
  customers.set("cus_1", { id: "cus_1", email: "paid@trademind.test", metadata: {} });
  customerUsers = [{ id: "user_1", email: "paid@trademind.test" }];
});

describe("checkout callback (checkout.session.completed -> subscription sync)", () => {
  it("promotes a free account to the purchased tier", async () => {
    expect(entitlementsFor("user_1").tier).toBe("free");
    expect(entitlementsFor("user_1").capabilities).not.toContain("analytics");

    await syncSubscription(stripeSub({ status: "active", tier: "pro" }), NOW);

    const ent = entitlementsFor("user_1");
    expect(ent.tier).toBe("pro");
    expect(ent.isPaid).toBe(true);
    expect(ent.gradeLimit).toBeNull();
    expect(ent.capabilities).toContain("analytics");
    expect(ent.capabilities).toContain("signal_engine");
    expect(ent.capabilities).not.toContain("autopilot");
  });

  it("grants elite-only capabilities on an elite checkout", async () => {
    await syncSubscription(stripeSub({ status: "active", tier: "elite" }), NOW);
    const ent = entitlementsFor("user_1");
    expect(ent.tier).toBe("elite");
    expect(ent.capabilities).toContain("autopilot");
    expect(ent.capabilities).toContain("broker_live");
  });

  it("keeps basic below pro surfaces", async () => {
    await syncSubscription(stripeSub({ status: "active", tier: "basic" }), NOW);
    const ent = entitlementsFor("user_1");
    expect(ent.tier).toBe("basic");
    expect(ent.capabilities).toContain("analytics");
    expect(ent.capabilities).not.toContain("signal_engine");
  });

  it("stores the renewal date and no scheduled cancellation", async () => {
    const periodEnd = NOW + 14 * 24 * HOUR;
    await syncSubscription(stripeSub({ status: "active", tier: "pro", periodEnd }), NOW);
    const row = rowFor("user_1")!;
    expect(row["current_period_end"]).toBe(new Date(periodEnd * 1000).toISOString());
    expect(row["cancel_at_period_end"]).toBe(false);
  });

  it("resolves the user by customer email when metadata is missing", async () => {
    await syncSubscription(
      stripeSub({ status: "active", tier: "pro", userId: null }),
      NOW,
    );
    expect(entitlementsFor("user_1").tier).toBe("pro");
    // Mapping is cached back onto the Stripe customer.
    expect(customers.get("cus_1")!.metadata["user_id"]).toBe("user_1");
  });

  it("reports no_user when the customer cannot be matched", async () => {
    customerUsers = [];
    const res = await syncSubscription(
      stripeSub({ status: "active", tier: "pro", userId: null }),
      NOW,
    );
    expect(res).toEqual({ ok: false, reason: "no_user" });
    expect(rowFor("user_1")).toBeNull();
  });
});

describe("portal callback: cancel and resume", () => {
  it("keeps paid access while a cancellation is only scheduled", async () => {
    await syncSubscription(stripeSub({ status: "active", tier: "pro" }), NOW);
    await syncSubscription(
      stripeSub({ status: "active", tier: "pro", cancelAtPeriodEnd: true }),
      NOW + 60,
    );

    const row = rowFor("user_1")!;
    expect(row["cancel_at_period_end"]).toBe(true);
    const ent = entitlementsFor("user_1");
    expect(ent.isPaid).toBe(true);
    expect(ent.tier).toBe("pro");
  });

  it("clears the scheduled cancellation on resume", async () => {
    await syncSubscription(
      stripeSub({ status: "active", tier: "pro", cancelAtPeriodEnd: true }),
      NOW,
    );
    await syncSubscription(
      stripeSub({ status: "active", tier: "pro", cancelAtPeriodEnd: false }),
      NOW + 60,
    );
    expect(rowFor("user_1")!["cancel_at_period_end"]).toBe(false);
    expect(entitlementsFor("user_1").isPaid).toBe(true);
  });

  it("drops to free once the subscription is actually canceled", async () => {
    await syncSubscription(
      stripeSub({ status: "active", tier: "pro", cancelAtPeriodEnd: true }),
      NOW,
    );
    await syncSubscription(stripeSub({ status: "canceled", tier: "pro" }), NOW + 120);

    const row = rowFor("user_1")!;
    expect(row["tier"]).toBeNull();
    expect(row["current_period_end"]).toBeNull();
    expect(row["cancel_at_period_end"]).toBe(false);

    const ent = entitlementsFor("user_1");
    expect(ent.tier).toBe("free");
    expect(ent.isPaid).toBe(false);
    expect(ent.gradeLimit).toBe(2);
    expect(ent.capabilities).not.toContain("analytics");
    expect(ent.capabilities).toContain("journal");
  });

  it("drops to free on unpaid and incomplete_expired too", async () => {
    for (const status of ["unpaid", "incomplete_expired"]) {
      db.subscriptions.clear();
      await syncSubscription(stripeSub({ status: "active", tier: "elite" }), NOW);
      await syncSubscription(stripeSub({ status, tier: "elite" }), NOW + 60);
      expect(entitlementsFor("user_1").tier).toBe("free");
    }
  });

  it("keeps access during past_due so a retry does not lock the user out", async () => {
    await syncSubscription(stripeSub({ status: "past_due", tier: "pro" }), NOW);
    const ent = entitlementsFor("user_1");
    expect(ent.isPaid).toBe(true);
    expect(ent.tier).toBe("pro");
  });

  it("treats a trialing subscription as paid", async () => {
    await syncSubscription(
      stripeSub({ status: "trialing", tier: "pro", trialEnd: NOW + 7 * 24 * HOUR }),
      NOW,
    );
    expect(entitlementsFor("user_1").isPaid).toBe(true);
  });
});

describe("delivery reliability", () => {
  it("ignores an out-of-order older event", async () => {
    await syncSubscription(stripeSub({ status: "canceled", tier: "pro" }), NOW + 600);
    const res = await syncSubscription(stripeSub({ status: "active", tier: "pro" }), NOW);
    expect(res).toMatchObject({ ok: true, skipped: "stale" });
    // Still free: the late "active" event did not resurrect paid access.
    expect(entitlementsFor("user_1").tier).toBe("free");
  });

  it("claims each event id once and releases it on failure", async () => {
    const evt = { id: "evt_1", type: "customer.subscription.updated", created: NOW };
    expect(await claimEvent(evt)).toBe(true);
    expect(await claimEvent(evt)).toBe(false);
    await releaseEvent("evt_1");
    expect(await claimEvent(evt)).toBe(true);
  });

  it("is idempotent when Stripe replays the same state", async () => {
    await syncSubscription(stripeSub({ status: "active", tier: "pro" }), NOW);
    const first = { ...rowFor("user_1") };
    await syncSubscription(stripeSub({ status: "active", tier: "pro" }), NOW);
    const second = rowFor("user_1")!;
    expect(second["tier"]).toBe(first["tier"]);
    expect(second["status"]).toBe(first["status"]);
    expect(entitlementsFor("user_1").tier).toBe("pro");
  });
});

describe("admin persona", () => {
  it("keeps full access with no subscription row", () => {
    const ent = entitlementsFor("user_1", true);
    expect(ent.isAdmin).toBe(true);
    expect(ent.capabilities).toContain("autopilot");
    expect(ent.gradeLimit).toBeNull();
  });
});
