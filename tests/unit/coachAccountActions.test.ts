import { describe, expect, it } from "vitest";
import { tradeLockerAccountType } from "@/lib/tradelocker-account.shared";
import { tlNumber, tlRecord } from "@/lib/tradelocker-data.shared";
import { assertCoachAccount, assertCoachConfirmation, coachPlanSchema } from "@/lib/coach-actions.shared";
import { brokerContextBlock } from "@/lib/broker-readonly.server";

describe("broker account classification and configured fields", () => {
  it("does not treat a zero balance as demo", () => {
    const account = { type: "live", accountBalance: 0 };
    expect(tradeLockerAccountType(account)).toBe("live");
  });
  it("does not treat 49900 as proof of demo", () => {
    const account = { accountBalance: 49900 };
    expect(tradeLockerAccountType(account)).toBe("unknown");
  });
  it("reads broker type independently of live API connection", () => {
    expect(tradeLockerAccountType({ type: "demo" })).toBe("demo");
  });
  it("reads unrealized P&L by configured column rather than open-date index", () => {
    const row = tlRecord([{ id: "openDate" }, { id: "unrealizedPl" }, { id: "stopLossId" }], [1793931000000, -120, "sl1"]);
    expect(tlNumber(row.unrealizedPl)).toBe(-120);
    expect(row.stopLossId).toBe("sl1");
  });
  it("preserves a real zero balance but missing data stays unknown", () => {
    expect(tlNumber("0.00")).toBe(0);
    expect(tlNumber(null)).toBeNull();
  });
});

describe("explicit account-bound trading confirmation", () => {
  const now = Date.parse("2026-11-06T02:40:00Z");
  const expiry = "2026-11-06T02:45:00Z";
  it("refuses an unconfirmed action", () => {
    expect(() => assertCoachConfirmation(expiry, false, false, false, now)).toThrow();
  });
  it("refuses real-money actions without acknowledgement", () => {
    expect(() => assertCoachConfirmation(expiry, true, true, false, now)).toThrow();
  });
  it("permits an explicitly confirmed demo review", () => {
    expect(() => assertCoachConfirmation(expiry, true, false, false, now)).not.toThrow();
  });
  it("expires a review exactly five minutes after preparation", () => {
    expect(() => assertCoachConfirmation(expiry, true, false, false, now + 5 * 60_000)).toThrow();
  });
  it("refuses switching from confirmed demo account to another account", () => {
    expect(() => assertCoachAccount({ broker: "tradelocker", accountId: "demo1", env: "live" }, { broker: "tradelocker", accountId: "live2", env: "live" })).toThrow();
  });
  it("requires correctly sided protective levels", () => {
    expect(coachPlanSchema.safeParse({ symbol: "US30", side: "long", grade: "A", entry: 53695, stop: 54000, target: 54780 }).success).toBe(false);
    expect(coachPlanSchema.safeParse({ symbol: "US30", side: "long", grade: "A", entry: 53695, stop: 53412, target: 54780 }).success).toBe(true);
  });
  it("never offers a NO ENTRY plan for execution", () => {
    expect(coachPlanSchema.safeParse({ symbol: "US30", side: "long", grade: "NO ENTRY", entry: 53695, stop: 53412, target: 54780 }).success).toBe(false);
  });
  it("does not tell the coach a failed position read means flat", () => {
    const block = brokerContextBlock({ connected: true, snapshots: [{ broker: "tradelocker", env: "live", accountId: "1", currency: "USD", balance: 49900, equity: 49900,
      unrealizedPL: null, positions: [], recentCloses: [], fetchedAt: now, readWarnings: ["Open positions unavailable, not confirmed empty."] }] });
    expect(block).toContain("Open position count unknown");
    expect(block).not.toContain("No open positions.");
  });
});