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

describe("monthly reset happens on the 1st in the account's own timezone", () => {
  // Each case is an instant that is still the last day of the month locally
  // while UTC has already rolled over, or the reverse — the two disagree, so a
  // UTC-only implementation gets exactly one of them wrong.
  const cases = [
    {
      tz: "America/New_York", // UTC-4 in September
      label: "New York, UTC has rolled over but the local month has not",
      lastMomentOfMonth: "2026-09-01T03:59:00Z", // 23:59 Aug 31 local
      firstMomentOfNextMonth: "2026-09-01T04:00:00Z", // 00:00 Sep 1 local
      endedMonth: "2026-08",
      newMonth: "2026-09",
    },
    {
      tz: "America/Los_Angeles", // UTC-7
      label: "Los Angeles, seven hours behind UTC",
      lastMomentOfMonth: "2026-09-01T06:59:00Z",
      firstMomentOfNextMonth: "2026-09-01T07:00:00Z",
      endedMonth: "2026-08",
      newMonth: "2026-09",
    },
    {
      tz: "Asia/Tokyo", // UTC+9 — the local month rolls over before UTC does
      label: "Tokyo, nine hours ahead of UTC",
      lastMomentOfMonth: "2026-08-31T14:59:00Z", // 23:59 Aug 31 local
      firstMomentOfNextMonth: "2026-08-31T15:00:00Z", // 00:00 Sep 1 local
      endedMonth: "2026-08",
      newMonth: "2026-09",
    },
    {
      tz: "Pacific/Kiritimati", // UTC+14, the earliest zone on earth
      label: "Kiritimati, fourteen hours ahead of UTC",
      lastMomentOfMonth: "2026-08-31T09:59:00Z",
      firstMomentOfNextMonth: "2026-08-31T10:00:00Z",
      endedMonth: "2026-08",
      newMonth: "2026-09",
    },
    {
      tz: "Australia/Adelaide", // UTC+9:30, a half-hour offset
      label: "Adelaide, a half-hour offset",
      lastMomentOfMonth: "2026-08-31T14:29:00Z",
      firstMomentOfNextMonth: "2026-08-31T14:30:00Z",
      endedMonth: "2026-08",
      newMonth: "2026-09",
    },
    {
      tz: "Europe/London",
      label: "London, one hour ahead of UTC under summer time",
      lastMomentOfMonth: "2026-08-31T22:59:00Z",
      firstMomentOfNextMonth: "2026-08-31T23:00:00Z",
      endedMonth: "2026-08",
      newMonth: "2026-09",
    },
  ] as const;

  it.each(cases)("$label", async (c) => {
    const spend = async (tz: string, now: Date) => {
      for (const symbol of ["XAUUSD", "EURUSD", "US30"]) {
        await consumeGradeFlow({
          entitlements: freeAccount(),
          timezone: tz,
          store: db,
          input: { outcome: "graded", symbol, timeframe: "1h", methodology: "wyckoff" },
          now,
        });
      }
    };

    const beforeMidnight = new Date(c.lastMomentOfMonth);
    const afterMidnight = new Date(c.firstMomentOfNextMonth);

    // The month key is the local calendar month, so it flips exactly at local
    // midnight — never at UTC midnight.
    expect(monthKey(c.tz, beforeMidnight)).toBe(c.endedMonth);
    expect(monthKey(c.tz, afterMidnight)).toBe(c.newMonth);

    // Spend the whole allowance in the outgoing local month.
    await spend(c.tz, beforeMidnight);
    const spent = await consumeGradeFlow({
      entitlements: freeAccount(),
      timezone: c.tz,
      store: db,
      input: { outcome: "graded", symbol: "NAS100", timeframe: "1h" },
      now: beforeMidnight,
    });
    expect(spent.reason).toBe("limit_reached");
    expect(shouldPaywallOnIntent(spent.quota)).toBe(true);
    expect(db.months.get(c.endedMonth)).toBe(FREE_GRADES_PER_MONTH);

    // One minute later it is the 1st locally: a fresh three grades.
    const afterReset = await consumeGradeFlow({
      entitlements: freeAccount(),
      timezone: c.tz,
      store: db,
      input: { outcome: "graded", symbol: "NAS100", timeframe: "1h" },
      now: afterMidnight,
    });
    expect(afterReset.charged).toBe(true);
    expect(afterReset.quota.used).toBe(1);
    expect(afterReset.quota.remaining).toBe(2);
    expect(shouldPaywallOnIntent(afterReset.quota)).toBe(false);
    expect(quotaLabel(afterReset.quota)).toBe("2 of 3 grades left this month");

    // The old month's record is untouched by the new month's usage.
    expect(db.months.get(c.endedMonth)).toBe(FREE_GRADES_PER_MONTH);
    expect(db.months.get(c.newMonth)).toBe(1);
  });

  it("does not reset on UTC midnight for an account that is still in the old month locally", async () => {
    const tz = "America/New_York";
    const utcMidnight = new Date("2026-09-01T00:30:00Z"); // 20:30 Aug 31 in New York
    expect(monthKey(tz, utcMidnight)).toBe("2026-08");
    expect(monthKey("UTC", utcMidnight)).toBe("2026-09"); // UTC has already rolled

    db.months.set("2026-08", FREE_GRADES_PER_MONTH);
    const attempt = await consumeGradeFlow({
      entitlements: freeAccount(),
      timezone: tz,
      store: db,
      input: { outcome: "graded", symbol: "XAUUSD", timeframe: "1h" },
      now: utcMidnight,
    });
    expect(attempt.charged).toBe(false);
    expect(attempt.reason).toBe("limit_reached");
    expect(db.months.get("2026-09")).toBeUndefined();
  });

  it("does not hand an extra allowance to an account that is already in the new month locally", async () => {
    const tz = "Asia/Tokyo";
    const beforeUtcRollover = new Date("2026-08-31T20:00:00Z"); // 05:00 Sep 1 in Tokyo
    expect(monthKey(tz, beforeUtcRollover)).toBe("2026-09");
    expect(monthKey("UTC", beforeUtcRollover)).toBe("2026-08");

    db.months.set("2026-08", FREE_GRADES_PER_MONTH); // last month is spent
    for (let i = 1; i <= FREE_GRADES_PER_MONTH; i += 1) {
      const res = await consumeGradeFlow({
        entitlements: freeAccount(),
        timezone: tz,
        store: db,
        input: { outcome: "graded", symbol: `SYM${i}`, timeframe: "1h" },
        now: beforeUtcRollover,
      });
      expect(res.charged).toBe(true);
      expect(res.quota.used).toBe(i);
    }
    const fourth = await consumeGradeFlow({
      entitlements: freeAccount(),
      timezone: tz,
      store: db,
      input: { outcome: "graded", symbol: "SYM4", timeframe: "1h" },
      now: beforeUtcRollover,
    });
    expect(fourth.reason).toBe("limit_reached");
    expect(db.months.get("2026-09")).toBe(FREE_GRADES_PER_MONTH);
  });

  it("falls back to UTC when the account has no usable timezone", () => {
    const at = new Date("2026-09-01T00:30:00Z");
    expect(monthKey(null, at)).toBe("2026-09");
    expect(monthKey("Not/AZone", at)).toBe("2026-09");
  });
});

describe("an identical re-scan inside the 10 minute window is free", () => {
  const sameScan = { symbol: "XAUUSD", timeframe: "15m", methodology: "wyckoff" } as const;
  const at = (minutes: number) => new Date(db.now.getTime() + minutes * 60 * 1000);
  const rescan = (minutes: number, over: Partial<typeof sameScan> = {}) =>
    consumeGradeFlow({
      entitlements: freeAccount(),
      timezone: TZ,
      store: db,
      input: { outcome: "graded", ...sameScan, ...over },
      now: at(minutes),
    });

  it("repeated identical scans across the window never reduce remaining grades", async () => {
    const first = await rescan(0);
    expect(first.charged).toBe(true);
    expect(first.quota.used).toBe(1);
    expect(first.quota.remaining).toBe(2);
    const chargesAfterFirst = db.incrementAttempts;

    // Hammer the same instrument + timeframe + methodology through the window.
    for (const minutes of [0, 0.5, 1, 2, 4, 6, 8, 9, 9.983]) {
      const again = await rescan(minutes);
      expect(again.charged).toBe(false);
      expect(again.reason).toBe("not_chargeable");
      expect(again.quota.used).toBe(1);
      expect(again.quota.remaining).toBe(2);
      expect(quotaLabel(again.quota)).toBe("2 of 3 grades left this month");
      expect(shouldPaywallOnIntent(again.quota)).toBe(false);
    }

    // Not a single further write reached the counter.
    expect(db.incrementAttempts).toBe(chargesAfterFirst);
    expect(await db.readUsed(monthKey(TZ, db.now))).toBe(1);
  });

  it("charges once at the window edge: free at 9:59, chargeable at exactly 10:00", async () => {
    expect((await rescan(0)).charged).toBe(true);
    expect((await rescan(9 + 59 / 60)).charged).toBe(false);

    const atTen = await rescan(10);
    expect(atTen.charged).toBe(true);
    expect(atTen.quota.used).toBe(2);
    expect(atTen.quota.remaining).toBe(1);
  });

  it("only an exact instrument + timeframe + methodology match is free", async () => {
    expect((await rescan(0)).charged).toBe(true);
    expect((await rescan(1)).charged).toBe(false); // exact match, free

    // Each differing component is a different question and costs a grade.
    expect((await rescan(1, { symbol: "EURUSD" })).charged).toBe(true);
    expect((await rescan(1, { timeframe: "1h" })).charged).toBe(true);
    expect((await rescan(1, { methodology: "smc" })).charged).toBe(true);
    expect(await db.readUsed(monthKey(TZ, db.now))).toBe(4);
  });

  it("free re-scans still work when the last grade of the month was the one that paid for them", async () => {
    // Spend down to the final grade, then buy the answer with it.
    for (const symbol of ["EURUSD", "US30"]) {
      expect((await rescan(0, { symbol })).charged).toBe(true);
    }
    const last = await rescan(0);
    expect(last.charged).toBe(true);
    expect(last.quota.remaining).toBe(0);
    expect(last.quota.exhausted).toBe(true);

    // Re-opening the same answer is free and never shows the paywall,
    // even though the month is spent.
    const repeat = await rescan(5);
    expect(repeat.charged).toBe(false);
    expect(repeat.reason).toBe("not_chargeable");
    expect(repeat.quota.used).toBe(FREE_GRADES_PER_MONTH);
    expect(db.incrementAttempts).toBe(FREE_GRADES_PER_MONTH);
  });
});
