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
 * Docs shape: { data: [{ starting_at, results: [{ amount, currency, ... }] }] }
 */
export async function fetchAnthropicCost(startingAt: Date, endingAt?: Date): Promise<AnthropicCostReport> {
  const adminKey = process.env["ANTHROPIC_ADMIN_KEY"];
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const base: AnthropicCostReport = {
    configured: Boolean(adminKey),
    monthStart: monthStart.toISOString(),
    monthToDateUsd: 0,
    todayUsd: 0,
    buckets: [],
    error: null,
    fetchedAt: now.toISOString(),
  };

  if (!adminKey) {
    return {
      ...base,
      error:
        "No Anthropic admin key saved. Anthropic only exposes billed cost through their Admin API, which needs an admin key (starts with sk-ant-admin) from the Anthropic console.",
    };
  }

  const params = new URLSearchParams({
    starting_at: `${utcDay(startingAt)}T00:00:00Z`,
    bucket_width: "1d",
    limit: "31",
  });
  if (endingAt) params.set("ending_at", `${utcDay(endingAt)}T00:00:00Z`);

  try {
    const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`, {
      headers: {
        "x-api-key": adminKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      const hint =
        res.status === 401 || res.status === 403
          ? " That key is not an Anthropic admin key, or it lacks billing access."
          : "";
      return { ...base, error: `Anthropic cost report returned ${res.status}.${hint} ${body}`.trim() };
    }
    const json = (await res.json()) as {
      data?: Array<{ starting_at?: string; results?: Array<{ amount?: number | string; currency?: string }> }>;
    };

    const buckets: AnthropicCostBucket[] = (json.data ?? []).map((bucket) => {
      const day = (bucket.starting_at ?? "").slice(0, 10);
      const amountUsd = (bucket.results ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
      return { day, amountUsd };
    });

    const today = utcDay(now);
    const monthDay = utcDay(monthStart);
    const monthToDateUsd = buckets
      .filter((b) => b.day >= monthDay)
      .reduce((s, b) => s + b.amountUsd, 0);
    const todayUsd = buckets.filter((b) => b.day === today).reduce((s, b) => s + b.amountUsd, 0);

    return { ...base, buckets, monthToDateUsd, todayUsd };
  } catch (e) {
    return { ...base, error: `Anthropic cost report failed: ${(e as Error).message}` };
  }
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
