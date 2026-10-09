import { describe, expect, it } from "vitest";
import { planEdited, withLockedPlan } from "@/lib/journal-lock.shared";

describe("journal locked plan", () => {
  it("locks entry, stop and target when first logged", () => {
    const t = withLockedPlan({ entry: 100, stop: 95, takeProfit: 110, createdAt: 5 });
    expect(t.lockedPlan).toEqual({ entry: 100, stop: 95, takeProfit: 110, lockedAt: 5 });
  });

  it("keeps the original plan after the trader moves the stop", () => {
    const logged = withLockedPlan({ entry: 100, stop: 95, takeProfit: 110, createdAt: 5 });
    const edited = withLockedPlan({ ...logged, stop: 90 });
    expect(edited.lockedPlan?.stop).toBe(95);
    expect(planEdited(edited)).toBe(true);
  });

  it("is not edited when levels are unchanged", () => {
    expect(planEdited(withLockedPlan({ entry: 100, stop: 95, takeProfit: 110 }))).toBe(false);
  });

  it("does not lock a trade without a stop", () => {
    expect(withLockedPlan({ entry: 100, stop: 0 }).lockedPlan).toBeUndefined();
  });
});
