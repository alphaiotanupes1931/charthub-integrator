// Which model runs the scan narrative.
//
// Same routing rule as the chat coach: Claude first, Gemini through the AI
// gateway only as a fallback. Direction, entry, stop, targets, grade and
// confidence stay deterministic - this only decides who writes the words and
// fills the structured draft.

import type { LanguageModel } from "ai";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";

export const SCAN_FALLBACK_MODEL = "google/gemini-3-flash-preview";
export const SCAN_CLAUDE_MODEL = "claude-sonnet-4-5";

export type ScanModelRun<T> = (model: LanguageModel, modelLabel: string) => Promise<T>;

let healthCache: { ok: boolean; at: number } | null = null;
const HEALTH_TTL_MS = 5 * 60 * 1000;

async function claudeUsable(): Promise<boolean> {
  if (!process.env['ANTHROPIC_API_KEY']) return false;
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_TTL_MS) return healthCache.ok;
  let ok = false;
  try {
    const { probeClaude } = await import("@/lib/ai-credits.server");
    ok = (await probeClaude()).status === "ok";
  } catch {
    ok = false;
  }
  healthCache = { ok, at: now };
  return ok;
}

/** Reset the cached Claude health probe (tests). */
export function resetScanModelHealthCache() {
  healthCache = null;
}

function geminiModel(apiKey: string): LanguageModel {
  return createAiGatewayProvider(apiKey)(SCAN_FALLBACK_MODEL) as unknown as LanguageModel;
}

/**
 * Run one scan model call with Claude first and Gemini as the fallback.
 * Any Claude failure (no key, unhealthy account, bad output, transport error)
 * falls through to the gateway so a scan never dies on the primary model.
 */
export async function runScanModel<T>(apiKey: string, run: ScanModelRun<T>): Promise<T> {
  if (await claudeUsable()) {
    try {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const model = createAnthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! })(
        SCAN_CLAUDE_MODEL,
      ) as unknown as LanguageModel;
      return await run(model, SCAN_CLAUDE_MODEL);
    } catch {
      healthCache = { ok: false, at: Date.now() };
    }
  }
  return run(geminiModel(apiKey), SCAN_FALLBACK_MODEL);
}
