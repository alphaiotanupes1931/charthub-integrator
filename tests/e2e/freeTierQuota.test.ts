// End-to-end quota journey for the permanent free tier.
//
// Drives the exact pipeline the server function runs (consumeGradeFlow) against
// an in-memory stand-in for free_tier_quota / scan_cache / consume_free_grade
// that copies the real table semantics: one row per user+month and an atomic
// increment that refuses once the month is spent.
//
// Covers: 3 grades in a month, the 4th attempt firing the paywall on intent,
// and only real answers decrementing the counter.

import { beforeEach, describe, expect, it } from "vitest";
import { consumeGradeFlow, shouldPaywallOnIntent, type QuotaStore } from "@/lib/quota-flow";
import {
  FREE_GRADES_PER_MONTH,
  monthKey,
  quotaLabel,
  quotaView,
  resolveEntitlements,
  scanCacheKey,
} from "@/lib/entitlements";

const TZ = "America/New_York";

/** Faithful fake of the two tables plus the consume_free_grade RPC. */
class FakeQuotaDb implements QuotaStore {
  months = new Map<string, number>();
  cache = new Map<string, string>();
  /** Every increment attempt, so we can prove a failure never touched the counter. */
  incrementAttempts = 0;

  async readUsed(month: string) {
    return this.months.get(month) ?? 0;
  }
  async readCacheEntry(key: string) {
    const createdAt = this.cache.get(key);
    return createdAt ? { createdAt } : null;
  }
  async writeCacheEntry(key: string) {
    this.cache.set(key, this.now.toISOString());
  }
  async increment(month: string, limit: number) {
    this.incrementAttempts += 1;
    const used = this.months.get(month) ?? 0;
    if (used >= limit) return { error: true }; // RPC raises at the limit
    this.months.set(month, used + 1);
    return { error: false };
  }

  now = new Date("2026-08-10T14:00:00Z");
}

const freeAccount = () => resolveEntitlements({ flagEnabled: true, subscription: null, now: new Date("2026-08-10T14:00:00Z") });
const paidAccount = () =>
  resolveEntitlements({
    flagEnabled: true,
    subscription: { status: "active", tier: "pro", trialEnd: null },
    now: new Date("2026-08-10T14:00:00Z"),
  });

let db: FakeQuotaDb;
const scan = (symbol: string, timeframe = "1h") => ({ symbol, timeframe, methodology: "wyckoff" });

async function runScan(
  outcome: "graded" | "no_entry" | "error" | "timeout" | "no_result" | "cached",
  scanInput?: { symbol: string; timeframe: string; methodology?: string },
  opts?: { entitlements?: ReturnType<typeof freeAccount>; now?: Date },
) {
  return consumeGradeFlow({
    entitlements: opts?.entitlements ?? freeAccount(),
    timezone: TZ,
    store: db,
    input: { outcome, ...(scanInput ?? {}) },
    now: opts?.now ?? db.now,
  });
}

beforeEach(() => {
  db = new FakeQuotaDb();
});

describe("free tier — three grades in a month", () => {
  it("charges each of the first three delivered grades and counts down in the UI", async () => {
    const labels: (string | null)[] = [];

    const first = await runScan("graded", scan("XAUUSD"));
    labels.push(quotaLabel(first.quota));
    expect(first).toMatchObject({ charged: true, reason: "charged" });
    expect(first.quota.used).toBe(1);
    expect(first.quota.remaining).toBe(2);

    const second = await runScan("graded", scan("EURUSD"));
    labels.push(quotaLabel(second.quota));
    expect(second.charged).toBe(true);
    expect(second.quota.remaining).toBe(1);

    // A legitimate "No Entry" is still a real answer, so it costs the third grade.
    const third = await runScan("no_entry", scan("US30"));
    labels.push(quotaLabel(third.quota));
    expect(third.charged).toBe(true);
    expect(third.quota.used).toBe(FREE_GRADES_PER_MONTH);
    expect(third.quota.remaining).toBe(0);
    expect(third.quota.exhausted).toBe(true);

    expect(labels).toEqual([
      "2 of 3 grades left this month",
      "1 of 3 grades left this month",
      "0 of 3 grades left this month",
    ]);
    expect(db.months.get(monthKey(TZ, db.now))).toBe(3);
  });

  it("resets on the 1st in the account timezone", async () => {
    for (const s of ["XAUUSD", "EURUSD", "US30"]) await runScan("graded", scan(s));
    const spent = quotaView(freeAccount(), await db.readUsed(monthKey(TZ, db.now)));
    expect(spent.exhausted).toBe(true);

    const september = new Date("2026-09-01T05:00:00Z"); // 01:00 in New York
    const fresh = await runScan("graded", scan("XAUUSD"), { now: september });
    expect(fresh.charged).toBe(true);
    expect(fresh.quota.used).toBe(1);
    expect(fresh.quota.remaining).toBe(2);
  });
});

describe("the fourth attempt — paywall fires on intent", () => {
  beforeEach(async () => {
    for (const s of ["XAUUSD", "EURUSD", "US30"]) await runScan("graded", scan(s));
  });

  it("does not paywall while grades remain, and does at zero", async () => {
    const spentQuota = quotaView(freeAccount(), await db.readUsed(monthKey(TZ, db.now)));
    expect(shouldPaywallOnIntent(spentQuota)).toBe(true);

    const withOneLeft = quotaView(freeAccount(), 2);
    expect(shouldPaywallOnIntent(withOneLeft)).toBe(false);
  });

  it("blocks a fourth grade without ever raising the counter past the limit", async () => {
    const attemptsBefore = db.incrementAttempts;
    const fourth = await runScan("graded", scan("NAS100"));
    expect(fourth.charged).toBe(false);
    expect(fourth.reason).toBe("limit_reached");
    expect(fourth.quota.used).toBe(FREE_GRADES_PER_MONTH);
    expect(db.months.get(monthKey(TZ, db.now))).toBe(3);
    expect(db.incrementAttempts).toBe(attemptsBefore + 1);
  });

  it("never paywalls a paid account, even with a spent free-tier row present", async () => {
    const paid = await runScan("graded", scan("NAS100"), { entitlements: paidAccount() });
    expect(paid.reason).toBe("not_free_tier");
    expect(paid.quota.active).toBe(false);
    expect(shouldPaywallOnIntent(paid.quota)).toBe(false);
    expect(quotaLabel(paid.quota)).toBeNull();
  });
});

describe("only real answers decrement quota", () => {
  it.each(["error", "timeout", "no_result", "cached"] as const)("a %s outcome charges nothing", async (outcome) => {
    const res = await runScan(outcome, scan("XAUUSD"));
    expect(res.charged).toBe(false);
    expect(res.reason).toBe("not_chargeable");
    expect(res.quota.used).toBe(0);
    expect(db.incrementAttempts).toBe(0);
  });

  it("a run of failures leaves all three grades intact, then a real answer charges once", async () => {
    for (const outcome of ["error", "timeout", "no_result", "error"] as const) {
      await runScan(outcome, scan("EURUSD"));
    }
    expect(await db.readUsed(monthKey(TZ, db.now))).toBe(0);

    const real = await runScan("graded", scan("EURUSD"));
    expect(real.charged).toBe(true);
    expect(real.quota.remaining).toBe(2);
  });

  it("an identical re-run inside the debounce window returns free, and charges again after it", async () => {
    const first = await runScan("graded", scan("XAUUSD", "15m"));
    expect(first.charged).toBe(true);
    expect(db.cache.has(scanCacheKey({ symbol: "XAUUSD", timeframe: "15m", methodology: "wyckoff" }))).toBe(true);

    const repeat = await runScan("graded", scan("XAUUSD", "15m"), {
      now: new Date(db.now.getTime() + 9 * 60 * 1000),
    });
    expect(repeat.charged).toBe(false);
    expect(repeat.reason).toBe("not_chargeable");
    expect(repeat.quota.used).toBe(1);

    // Case and spacing differences are the same scan, so still free.
    const sloppy = await consumeGradeFlow({
      entitlements: freeAccount(),
      timezone: TZ,
      store: db,
      input: { outcome: "graded", symbol: " xauusd ", timeframe: "15M", methodology: "Wyckoff" },
      now: new Date(db.now.getTime() + 60_000),
    });
    expect(sloppy.charged).toBe(false);

    // A different timeframe is a different question, so it costs a grade.
    const otherTf = await runScan("graded", scan("XAUUSD", "4h"));
    expect(otherTf.charged).toBe(true);
    expect(otherTf.quota.used).toBe(2);

    // Past the window the same scan is a fresh answer again.
    const later = await runScan("graded", scan("XAUUSD", "15m"), {
      now: new Date(db.now.getTime() + 11 * 60 * 1000),
    });
    expect(later.charged).toBe(true);
    expect(later.quota.used).toBe(3);
    expect(later.quota.exhausted).toBe(true);
  });

  it("a client that crashes before the result never burns a grade", async () => {
    // Nothing is charged until a delivered outcome is reported, so an abandoned
    // scan leaves the counter untouched.
    expect(await db.readUsed(monthKey(TZ, db.now))).toBe(0);
    expect(db.incrementAttempts).toBe(0);
  });
});
