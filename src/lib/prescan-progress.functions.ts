import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ANALYSIS_MODELS, type AnalysisModelId } from "@/lib/analysis-models";
import { leveledBank, pickNextQuestion, progressFor, type Attempt } from "@/lib/prescan-progress";

const ModelId = z.string().max(40);

function modelOf(id: string): AnalysisModelId {
  return (ANALYSIS_MODELS.find((m) => m.id === id)?.id ?? "classic") as AnalysisModelId;
}

/** The single question to ask before this scan, plus the trader's level. */
export const getNextPreScanQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ modelId: ModelId }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("prescan_question_attempts")
      .select("question_id, correct, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true })
      .limit(2000);
    const attempts = (rows ?? []) as Attempt[];
    const bank = leveledBank(modelOf(data.modelId));
    return {
      question: pickNextQuestion(attempts, bank),
      progress: progressFor(attempts, bank),
    };
  });

/** Record the answer. Correctness is decided here from the bank, not trusted from the browser. */
export const recordPreScanAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ modelId: ModelId, questionId: z.string().max(80), chosen: z.number().int().min(0).max(10) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const bank = leveledBank(modelOf(data.modelId));
    const q = bank.find((x) => x.id === data.questionId);
    if (!q) return { recorded: false, correct: false };
    const correct = q.correct === data.chosen;
    const { error } = await context.supabase.from("prescan_question_attempts").insert({
      user_id: context.userId,
      question_id: q.id,
      level: q.level,
      model_id: data.modelId,
      chosen_index: data.chosen,
      correct,
    });
    const { data: rows } = await context.supabase
      .from("prescan_question_attempts")
      .select("question_id, correct, created_at")
      .eq("user_id", context.userId)
      .limit(2000);
    return { recorded: !error, correct, progress: progressFor((rows ?? []) as Attempt[], bank) };
  });
