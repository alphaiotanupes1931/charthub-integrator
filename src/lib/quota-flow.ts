// The grade-quota pipeline, expressed against a small storage interface so the
// exact code the app runs can also be driven end to end in tests.
//
// Rules it enforces (§4):
//  - only a delivered answer (graded or a legitimate "No Entry") costs a grade
//  - failures, timeouts and empty results never decrement
//  - an identical symbol + timeframe + methodology re-run inside the debounce
//    window returns the stored answer and charges nothing
//  - paid, trialing and admin accounts never touch the counter at all

import {
  FREE_GRADES_PER_MONTH,
  isCacheFresh,
  dayKey,
  quotaView,
  scanCacheKey,
  shouldConsumeGrade,
  type Entitlements,
  type QuotaView,
  type ScanOutcome,
} from "@/lib/entitlements";

export type QuotaStore = {
  /** Grades already used in the given month for this account. */
  readUsed(month: string): Promise<number>;
  /** created_at of a stored scan answer for this cache key, if any. */
  readCacheEntry(key: string): Promise<{ createdAt: string } | null>;
  writeCacheEntry(key: string): Promise<void>;
  /**
   * Atomic increment, mirroring the consume_free_grade RPC: resolves when the
   * grade was charged, rejects (or returns an error) when the month is spent.
   */
  increment(month: string, limit: number): Promise<{ error: boolean }>;
};

export type ConsumeInput = {
  outcome: ScanOutcome["kind"];
  symbol?: string;
  timeframe?: string;
  methodology?: string;
};

export type ConsumeReason = "not_free_tier" | "not_chargeable" | "charged" | "limit_reached";

export type ConsumeOutcome = {
  charged: boolean;
  quota: QuotaView;
  reason: ConsumeReason;
};

export async function consumeGradeFlow(args: {
  entitlements: Entitlements;
  timezone: string;
  store: QuotaStore;
  input: ConsumeInput;
  now?: Date;
  limit?: number;
}): Promise<ConsumeOutcome> {
  const { entitlements, timezone, store, input } = args;
  const now = args.now ?? new Date();
  const limit = args.limit ?? FREE_GRADES_PER_MONTH;
  // The quota period is a day; the stored column is text, so the same row keying works.
  const month = dayKey(timezone, now);

  // Paid, trialing and admin accounts short-circuit before any quota code runs.
  if (!entitlements.freeTierActive) {
    return { charged: false, quota: quotaView(entitlements, 0), reason: "not_free_tier" };
  }

  const currentQuota = async () => quotaView(entitlements, await store.readUsed(month));

  if (!shouldConsumeGrade({ kind: input.outcome } as ScanOutcome)) {
    return { charged: false, quota: await currentQuota(), reason: "not_chargeable" };
  }

  if (input.symbol && input.timeframe) {
    const key = scanCacheKey({
      symbol: input.symbol,
      timeframe: input.timeframe,
      methodology: input.methodology ?? null,
    });
    const cached = await store.readCacheEntry(key);
    if (cached && isCacheFresh(cached.createdAt, now)) {
      return { charged: false, quota: await currentQuota(), reason: "not_chargeable" };
    }
    await store.writeCacheEntry(key);
  }

  const { error } = await store.increment(month, limit);
  if (error) {
    return { charged: false, quota: await currentQuota(), reason: "limit_reached" };
  }
  return { charged: true, quota: await currentQuota(), reason: "charged" };
}

/**
 * What the client asks before starting a scan. Mirrors `gradesExhausted` in
 * useEntitlements: the Run Scan control stays normal-looking and the paywall
 * fires on intent, i.e. at the click, not on page load.
 */
export function shouldPaywallOnIntent(quota: QuotaView): boolean {
  return quota.active && quota.exhausted;
}
