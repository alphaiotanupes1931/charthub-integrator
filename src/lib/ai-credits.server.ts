// Server-only AI credit / budget monitoring.
//
// Anthropic does not expose a "credits remaining" number on the messages API,
// so "credits left" here means: monthly budget minus month-to-date spend that
// we logged ourselves in ai_cost_log, combined with a live probe of the Claude
// endpoint that tells us whether the key is actually usable (a credit-exhausted
// key answers 400/402/429 with a credit balance message).
//
// The same check runs from the admin panel button and from the public webhook
// (/api/public/hooks/ai-credits), and fires deduped notifications to every
// admin when the budget runs low or the provider stops accepting calls.

export type ProviderStatus = "ok" | "out_of_credits" | "not_configured" | "error" | "unknown";

export interface AiCreditsSnapshot {
  monthlyBudgetUsd: number;
  lowThresholdPct: number;
  monthToDateUsd: number;
  remainingUsd: number;
  remainingPct: number;
  todayUsd: number;
  last7dUsd: number;
  providerStatus: ProviderStatus;
  providerMessage: string | null;
  checkedAt: string | null;
  monthStart: string;
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function sumCost(since: string): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("ai_cost_log")
    .select("cost_usd")
    .gte("created_at", since)
    .limit(50_000);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((s, r) => s + Number((r as { cost_usd: number }).cost_usd ?? 0), 0);
}

/** Live probe: is the Claude key usable, and if not, why. */
export async function probeClaude(): Promise<{ status: ProviderStatus; message: string | null }> {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) return { status: "not_configured", message: "ANTHROPIC_API_KEY is not set." };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (res.ok) return { status: "ok", message: null };
    const body = (await res.text()).slice(0, 300);
    const lowered = body.toLowerCase();
    if (res.status === 402 || lowered.includes("credit balance") || lowered.includes("insufficient")) {
      return { status: "out_of_credits", message: `Claude rejected the call (${res.status}): out of credits.` };
    }
    if (res.status === 429) {
      return { status: "error", message: `Claude rate limited (429). Coach falls back to Google Gemini.` };
    }
    return { status: "error", message: `Claude returned ${res.status}.` };
  } catch (e) {
    return { status: "error", message: `Claude probe failed: ${(e as Error).message}` };
  }
}

async function adminUserIds(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  return Array.from(new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)));
}

/**
 * Recompute the snapshot, persist provider status, and notify admins when the
 * budget is low or the provider is unusable. Safe to call repeatedly.
 */
export async function checkAiCredits(options: { notify?: boolean } = {}): Promise<AiCreditsSnapshot> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { createNotificationOnce } = await import("@/lib/notifications.server");

  const { data: budgetRow } = await supabaseAdmin
    .from("ai_budget")
    .select("monthly_budget_usd, low_threshold_pct")
    .eq("id", true)
    .maybeSingle();

  const monthlyBudgetUsd = Number((budgetRow as { monthly_budget_usd?: number } | null)?.monthly_budget_usd ?? 100);
  const lowThresholdPct = Number((budgetRow as { low_threshold_pct?: number } | null)?.low_threshold_pct ?? 20);

  const monthStart = monthStartIso();
  const dayStart = new Date(Date.now() - 24 * 3600_000).toISOString();
  const weekStart = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

  const [monthToDateUsd, todayUsd, last7dUsd, probe] = await Promise.all([
    sumCost(monthStart),
    sumCost(dayStart),
    sumCost(weekStart),
    probeClaude(),
  ]);

  const remainingUsd = Math.max(0, monthlyBudgetUsd - monthToDateUsd);
  const remainingPct = monthlyBudgetUsd > 0 ? Math.round((remainingUsd / monthlyBudgetUsd) * 100) : 0;
  const checkedAt = new Date().toISOString();

  await supabaseAdmin
    .from("ai_budget")
    .update({
      provider_status: probe.status,
      provider_message: probe.message,
      checked_at: checkedAt,
    })
    .eq("id", true);

  if (options.notify !== false) {
    const admins = await adminUserIds();
    const day = checkedAt.slice(0, 10);
    for (const userId of admins) {
      if (probe.status === "out_of_credits") {
        await createNotificationOnce(
          `ai-credits-out-${day}`,
          {
            userId,
            kind: "system",
            title: "Claude is out of credits",
            body: "The coach is running on Google Gemini until Claude credits are topped up.",
            url: "/admin",
          },
          24,
        );
      } else if (probe.status === "error" || probe.status === "not_configured") {
        await createNotificationOnce(
          `ai-provider-issue-${day}`,
          {
            userId,
            kind: "system",
            title: "Claude is not responding",
            body: probe.message ?? "Claude calls are failing. The coach falls back to Google Gemini.",
            url: "/admin",
          },
          24,
        );
      }
      if (remainingPct <= lowThresholdPct) {
        await createNotificationOnce(
          `ai-budget-low-${day}`,
          {
            userId,
            kind: "system",
            title: `AI budget at ${remainingPct}% remaining`,
            body: `Spent $${monthToDateUsd.toFixed(2)} of $${monthlyBudgetUsd.toFixed(2)} this month.`,
            url: "/admin",
          },
          24,
        );
      }
    }
  }

  return {
    monthlyBudgetUsd,
    lowThresholdPct,
    monthToDateUsd,
    remainingUsd,
    remainingPct,
    todayUsd,
    last7dUsd,
    providerStatus: probe.status,
    providerMessage: probe.message,
    checkedAt,
    monthStart,
  };
}
