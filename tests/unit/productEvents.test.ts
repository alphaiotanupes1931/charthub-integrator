import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("phase 5: copy", () => {
  it("never advertises the 7-day trial outside a free-tier flag check", () => {
    for (const file of ["src/routes/pricing.tsx", "src/routes/index.tsx"]) {
      const lines = read(file).split("\n");
      lines.forEach((line, i) => {
        if (!/7[- ]day|free trial|Free for 7 days/i.test(line)) return;
        // The flag check can sit a few lines above inside a multi-line ternary.
        const context = lines.slice(Math.max(0, i - 4), i + 2).join("\n");
        expect(context, `${file}: ${line.trim()}`).toMatch(/freeTier|hasHadTrial/);
      });
    }
  });

  it("stops sending trial_period_days when the free tier is on", () => {
    const src = read("src/lib/billing.functions.ts");
    expect(src).toContain("const offerTrial = !freeTierOn && !hasHadTrial;");
    expect(src).toMatch(/subscription_data: offerTrial/);
  });

  it("help copy no longer has a Trial section", () => {
    expect(read("src/lib/help-articles.ts")).not.toContain('"## Trial"');
  });
});

describe("phase 5: instrumentation", () => {
  it("enriches every event with the spec's conversion fields", () => {
    const src = read("src/lib/product-events.functions.ts");
    for (const field of ["days_on_free", "grades_used_lifetime", "journalled_trade_count"]) {
      expect(src).toContain(field);
    }
    expect(src).toContain("requireSupabaseAuth");
  });

  it("fires paywall, dismissal and upgrade-CTA events from one place", () => {
    const src = read("src/components/UpgradeModal.tsx");
    expect(src).toContain('track("paywall_shown"');
    expect(src).toContain('track("paywall_dismissed"');
    expect(src).toContain('track("upgrade_cta_clicked"');
  });

  it("fires grade usage and exhaustion only when a grade was actually charged", () => {
    const src = read("src/hooks/useEntitlements.ts");
    expect(src).toMatch(/if \(res\?\.charged\)[\s\S]*free_grade_used/);
    expect(src).toContain('track("free_quota_exhausted"');
  });

  it("fires preview and checkout events", () => {
    expect(read("src/routes/_app.analytics.tsx")).toContain('track("analytics_preview_viewed"');
    expect(read("src/routes/pricing.tsx")).toContain('track("checkout_started"');
  });

  it("tracking never throws into the UI", () => {
    expect(read("src/lib/product-events.ts")).toMatch(/try \{[\s\S]*\} catch \{/);
  });
});
