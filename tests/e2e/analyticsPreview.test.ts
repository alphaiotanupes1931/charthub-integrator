// Analytics preview vs full metrics.
//
// Live UI runs are in tests/e2e/analytics-preview-ui.py (Playwright, signs in as
// qa.free@trademind.test and qa.paid@trademind.test). This suite locks the two
// branches in source so the preview can't quietly turn into a blank lock page,
// and so the paid path never picks up the blur.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveEntitlements } from "../../src/lib/entitlements";

const src = readFileSync("src/routes/_app.analytics.tsx", "utf8");
const previewBlock = src.slice(
  src.indexOf('!ent.allow("analytics")'),
  src.indexOf("if (!hasAnyData)"),
);

describe("analytics entitlement", () => {
  it("free tier is not allowed analytics", () => {
    const ent = resolveEntitlements({ flagEnabled: true, subscription: null });
    expect(ent.tier).toBe("free");
    expect(ent.capabilities).not.toContain("analytics");
  });

  it("every paid tier is allowed analytics", () => {
    for (const tier of ["basic", "pro", "elite"]) {
      const ent = resolveEntitlements({
        flagEnabled: true,
        subscription: { status: "active", tier, trialEnd: null },
      });
      expect(ent.capabilities).toContain("analytics");
    }
  });
});

describe("free preview branch", () => {
  it("blurs the KPI grid instead of hiding it", () => {
    expect(previewBlock).toContain("blur-[6px]");
    expect(previewBlock).toContain("pointer-events-none");
    expect(previewBlock).toContain("aria-hidden");
  });

  it("shows the KPI labels so the value is visible behind the blur", () => {
    for (const label of ["Net P&L", "Win Rate", "Profit Factor", "Expectancy", "Max Drawdown"]) {
      expect(previewBlock).toContain(label);
    }
  });

  it("masks the actual numbers and offers the upgrade path", () => {
    expect(previewBlock).toContain('"--"');
    expect(previewBlock).toContain("Unlocks with any paid plan");
    expect(previewBlock).toContain('to="/pricing"');
    expect(previewBlock).toContain('to="/journal"');
  });
});

describe("paid branch", () => {
  it("renders computed metric values, unblurred", () => {
    const paid = src.slice(src.indexOf("if (!hasAnyData)"));
    expect(paid).not.toContain("blur-[6px]");
    expect(paid).not.toContain("Unlocks with any paid plan");
    for (const stat of ["stats?.winRate", "stats?.profitFactor", "stats?.netPnl"]) {
      expect(paid).toContain(stat);
    }
  });
});
