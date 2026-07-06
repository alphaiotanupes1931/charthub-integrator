// Hermes - the learning layer.
//
// Sits alongside the 3-layer research stack:
//   L1 Data → L2 Research → L3 Planner
//                              ↑↓
//                           Hermes  (memory of what has worked / hurt)
//
// Hermes never generates trade plans by itself. It:
//   1. Distils user feedback (thumbs up/down + note) into short, general lessons.
//   2. Serves the top-N relevant lessons back into the planner and strategy
//      builder as extra system-prompt context, so the coach visibly gets
//      sharper the more the user corrects it.
//
// This module is server-only (Supabase admin client).

import { generateText, Output } from "ai";
import { z } from "zod";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";

const MODEL = "google/gemini-3-flash-preview";

const LessonSchema = z.object({
  lesson: z.string().min(10).max(220),
  topic: z.string().min(1).max(60),
  scope: z.enum(["user", "global"]),
});

export type HermesLessonRow = {
  id: string;
  user_id: string | null;
  scope: string;
  topic: string;
  lesson: string;
  weight: number;
  created_at: string;
};

export async function distillLessonFromFeedback(
  apiKey: string,
  input: {
    kind: string; ticker?: string | null; interval?: string | null;
    lens?: string | null; coach?: string | null;
    rating: -1 | 1; note?: string | null;
    context: Record<string, unknown>;
  },
): Promise<{ lesson: string; topic: string; scope: "user" | "global" } | null> {
  try {
    const facts = [
      `Kind: ${input.kind}`,
      input.ticker ? `Ticker: ${input.ticker}` : "",
      input.interval ? `Interval: ${input.interval}` : "",
      input.lens ? `Scan lens: ${input.lens}` : "",
      input.coach ? `Coach: ${input.coach}` : "",
      `User rating: ${input.rating === 1 ? "helpful" : "not helpful"}`,
      input.note ? `User note: ${input.note}` : "",
      `Context: ${JSON.stringify(input.context).slice(0, 800)}`,
    ].filter(Boolean).join("\n");

    const provider = createAiGatewayProvider(apiKey);
    const { output } = await generateText({
      model: provider(MODEL),
      output: Output.object({ schema: LessonSchema }),
      system:
        "You are Hermes, a learning agent for a trading coach. Read one piece of feedback and write ONE short general lesson (max 30 words) the coach should apply next time to avoid repeating the mistake or repeat the win. " +
        "Choose scope='user' by default; only choose 'global' when the lesson is clearly universal (not tied to this trader's style). " +
        "Choose topic as ticker, lens, or 'general'. Do NOT restate the feedback verbatim.",
      prompt: facts,
    });
    return { lesson: output.lesson.trim(), topic: output.topic.trim().slice(0, 60), scope: output.scope };
  } catch {
    return null;
  }
}

export function formatLessonsForPrompt(rows: HermesLessonRow[]): string {
  if (!rows.length) return "";
  const top = rows.slice(0, 8);
  return [
    "Hermes memory - lessons from this trader's past feedback (apply them, do not restate):",
    ...top.map((r, i) => `${i + 1}. [${r.topic}] ${r.lesson}`),
  ].join("\n");
}
