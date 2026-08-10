// Server-only AI cost accounting.
//
// Every model call in the app funnels its token usage through logAiCost so the
// admin panel can answer two questions the client actually asked for: what does
// one graded setup cost, and what does one user cost per month.
//
// Attribution uses AsyncLocalStorage so deep helpers (analysts, planner) do not
// need a userId parameter threaded through eight call layers.

import { AsyncLocalStorage } from "node:async_hooks";

type CostCtx = { userId: string | null };

const store = new AsyncLocalStorage<CostCtx>();

/** Wrap a request handler so every nested AI call is attributed to this user. */
export function withAiCostUser<T>(userId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return store.run({ userId: userId ?? null }, fn);
}

function currentUserId(): string | null {
  return store.getStore()?.userId ?? null;
}

/** USD per 1M tokens. Keep in sync with provider pricing pages. */
const PRICES: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-5-20250929": { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "google/gemini-2.5-flash": { in: 0.3, out: 2.5, cacheWrite: 0.3, cacheRead: 0.075 },
  "google/gemini-3-flash-preview": { in: 0.5, out: 3, cacheWrite: 0.5, cacheRead: 0.125 },
};

const DEFAULT_PRICE = { in: 1, out: 5, cacheWrite: 1.25, cacheRead: 0.1 };

export function priceFor(model: string) {
  return PRICES[model] ?? DEFAULT_PRICE;
}

export type AiUsageLike = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
} | undefined;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function cacheWriteFrom(providerMetadata: unknown): number {
  const meta = providerMetadata as Record<string, Record<string, unknown>> | undefined;
  const anthropic = meta?.["anthropic"];
  return num(anthropic?.["cacheCreationInputTokens"]);
}

export type AiCostEntry = {
  /** chat | scan | analyst | planner | grade | news | journal | hermes */
  kind: string;
  model: string;
  usage: AiUsageLike;
  providerMetadata?: unknown;
  userId?: string | null;
};

/** Best effort: a logging failure must never break an AI response. */
export async function logAiCost(entry: AiCostEntry): Promise<void> {
  try {
    const price = priceFor(entry.model);
    const cached = num(entry.usage?.cachedInputTokens);
    const rawInput = num(entry.usage?.inputTokens);
    const uncached = Math.max(0, rawInput - cached);
    const output = num(entry.usage?.outputTokens);
    const cacheWrite = cacheWriteFrom(entry.providerMetadata);

    const cost =
      (uncached * price.in +
        cached * price.cacheRead +
        cacheWrite * price.cacheWrite +
        output * price.out) /
      1_000_000;

    if (!rawInput && !output && !cacheWrite) return;

    const userId = entry.userId ?? currentUserId();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_cost_log").insert({
      user_id: userId,
      kind: entry.kind,
      model: entry.model,
      input_tokens: uncached,
      cached_input_tokens: cached,
      cache_write_tokens: cacheWrite,
      output_tokens: output,
      cost_usd: Number(cost.toFixed(6)),
    } as never);
  } catch (e) {
    console.warn("[ai-cost] log failed", (e as Error).message);
  }
}
