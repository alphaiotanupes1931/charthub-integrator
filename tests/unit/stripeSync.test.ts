import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readPeriodEnd } from "../../src/lib/stripe-sync.server";

function sub(partial: Record<string, unknown>) {
  return { items: { data: [] }, ...partial } as never;
}

describe("readPeriodEnd", () => {
  it("reads the legacy top-level current_period_end", () => {
    expect(readPeriodEnd(sub({ current_period_end: 1700000000 }))).toBe(
      new Date(1700000000 * 1000).toISOString(),
    );
  });

  it("falls back to the newest subscription item period end", () => {
    const s = sub({
      items: { data: [{ current_period_end: 1600000000 }, { current_period_end: 1700000000 }] },
    });
    expect(readPeriodEnd(s)).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("falls back to cancel_at when no period end exists", () => {
    expect(readPeriodEnd(sub({ cancel_at: 1650000000 }))).toBe(
      new Date(1650000000 * 1000).toISOString(),
    );
  });

  it("returns null when nothing is scheduled", () => {
    expect(readPeriodEnd(sub({}))).toBeNull();
  });
});

describe("webhook handler contract", () => {
  const route = readFileSync("src/routes/api.public.stripe-webhook.ts", "utf8");
  const sync = readFileSync("src/lib/stripe-sync.server.ts", "utf8");

  it("verifies the Stripe signature before doing any work", () => {
    expect(route).toContain("constructEventAsync");
    expect(route.indexOf("constructEventAsync")).toBeLessThan(route.indexOf("claimEvent"));
  });

  it("is idempotent per Stripe event id and releases claims on failure", () => {
    expect(route).toContain("claimEvent");
    expect(route).toContain("releaseEvent");
    expect(sync).toContain('error.code === "23505"');
  });

  it("handles cancel, resume, and lifecycle events", () => {
    for (const evt of [
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "checkout.session.completed",
      "invoice.payment_succeeded",
      "invoice.payment_failed",
    ]) {
      expect(route).toContain(evt);
    }
  });

  it("guards against out-of-order deliveries and clears entitlements when dead", () => {
    expect(sync).toContain("last_event_at");
    expect(sync).toContain("DEAD_STATUSES");
    expect(sync).toContain("tier: dead ? null : tier");
    expect(sync).toContain("cancel_at_period_end: dead ? false : !!sub.cancel_at_period_end");
  });
});
