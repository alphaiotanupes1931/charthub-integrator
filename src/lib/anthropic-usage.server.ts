// Server-only: pull the REAL billed cost from Anthropic's own Admin API.
//
// Our ai_cost_log is an in-app estimate (tokens x price table). Anthropic's
// cost report is what they actually charge. The cost report lives on the
// Admin API and needs an ADMIN key (sk-ant-admin...), which is different from
// the regular ANTHROPIC_API_KEY used for model calls. If no admin key is set we
// say so plainly instead of guessing.

export interface AnthropicCostBucket {
  day: string; // YYYY-MM-DD
  amountUsd: number;
}

export interface AnthropicCostReport {
  configured: boolean;
  monthStart: string;
  monthToDateUsd: number;
  todayUsd: number;
  buckets: AnthropicCostBucket[];
  error: string | null;
  fetchedAt: string;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Anthropic cost report for a date range (UTC days, inclusive of start).
 * Shape: { data: [{ starting_at, results: [{ amount, currency, ... }] }] }
 *
 * The admin key may be saved under ANTHROPIC_ADMIN_KEY or, when the same key
 * doubles as the model key, under ANTHROPIC_API_KEY — try both.
 */
export async function fetchAnthropicCost(startingAt: Date, endingAt?: Date): Promise<AnthropicCostReport> {
  const keys = [process.env["ANTHROPIC_ADMIN_KEY"], process.env["ANTHROPIC_API_KEY"]].filter(
    (k): k is string => Boolean(k),
  );
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const base: AnthropicCostReport = {
    configured: keys.length > 0,
    monthStart: monthStart.toISOString(),
    monthToDateUsd: 0,
    todayUsd: 0,
    buckets: [],
    error: null,
    fetchedAt: now.toISOString(),
  };

  if (keys.length === 0) {
    return {
      ...base,
      error:
        "No Anthropic key saved. Billed cost comes from Anthropic's admin billing report, which needs a key with billing access.",
    };
  }

  let lastError = "";
  for (const key of keys) {
    try {
      const buckets: AnthropicCostBucket[] = [];
      let query: Record<string, string> = {
        starting_at: `${utcDay(startingAt)}T00:00:00Z`,
        bucket_width: "1d",
        limit: "31",
      };
      if (endingAt) query["ending_at"] = `${utcDay(endingAt)}T00:00:00Z`;

      // Paginate so long ranges are complete rather than truncated at 31 days.
      for (let page = 0; page < 24; page++) {
        const res = await fetch(
          `https://api.anthropic.com/v1/organizations/cost_report?${new URLSearchParams(query).toString()}`,
          { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } },
        );
        if (!res.ok) {
          lastError = `Anthropic billing report returned ${res.status}. ${(await res.text()).slice(0, 200)}`;
          buckets.length = 0;
          break;
        }
        const json = (await res.json()) as {
          data?: Array<{ starting_at?: string; results?: Array<{ amount?: number | string }> }>;
          has_more?: boolean;
          next_page?: string | null;
        };
        for (const bucket of json.data ?? []) {
          buckets.push({
            day: (bucket.starting_at ?? "").slice(0, 10),
            amountUsd: (bucket.results ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
          });
        }
        if (json.has_more && json.next_page) query = { page: json.next_page };
        else break;
      }

      if (buckets.length === 0) continue;

      const today = utcDay(now);
      const monthDay = utcDay(monthStart);
      return {
        ...base,
        buckets,
        monthToDateUsd: buckets.filter((b) => b.day >= monthDay).reduce((s, b) => s + b.amountUsd, 0),
        todayUsd: buckets.filter((b) => b.day === today).reduce((s, b) => s + b.amountUsd, 0),
      };
    } catch (e) {
      lastError = `Anthropic billing report failed: ${(e as Error).message}`;
    }
  }

  return { ...base, error: lastError || "Anthropic returned no billing data for this range." };
}

/** Month-to-date report, plus the in-app estimate for comparison. */
export async function anthropicMonthToDate(): Promise<
  AnthropicCostReport & { loggedEstimateUsd: number; differenceUsd: number }
> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [report, loggedEstimateUsd] = await Promise.all([
    fetchAnthropicCost(monthStart),
    sumLoggedEstimate(monthStart.toISOString()),
  ]);
  return {
    ...report,
    loggedEstimateUsd,
    differenceUsd: report.configured ? report.monthToDateUsd - loggedEstimateUsd : 0,
  };
}

async function sumLoggedEstimate(sinceIso: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("ai_cost_log")
    .select("cost_usd")
    .gte("created_at", sinceIso)
    .limit(50_000);
  if (error) return 0;
  return (data ?? []).reduce((s, r) => s + Number((r as { cost_usd: number }).cost_usd ?? 0), 0);
}
