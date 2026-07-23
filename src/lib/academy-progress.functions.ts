import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AcademyProgressPayload = {
  completed: Record<string, true>;
  last_module: number | null;
  last_lesson: string | null;
  quiz_scores: Record<string, { score: number; total: number; at: string }>;
  tour_done: boolean;
};

const EMPTY: AcademyProgressPayload = {
  completed: {},
  last_module: null,
  last_lesson: null,
  quiz_scores: {},
  tour_done: false,
};

export const loadAcademyProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("academy_progress")
      .select("completed, last_module, last_lesson, quiz_scores, tour_done")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) return EMPTY;
    if (!data) return EMPTY;
    return {
      completed: (data.completed ?? {}) as Record<string, true>,
      last_module: (data.last_module ?? null) as number | null,
      last_lesson: (data.last_lesson ?? null) as string | null,
      quiz_scores: (data.quiz_scores ?? {}) as AcademyProgressPayload["quiz_scores"],
      tour_done: Boolean(data.tour_done),
    } satisfies AcademyProgressPayload;
  });

export const saveAcademyProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Partial<AcademyProgressPayload>) => data)
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      ...(data.completed !== undefined ? { completed: data.completed } : {}),
      ...(data.last_module !== undefined ? { last_module: data.last_module } : {}),
      ...(data.last_lesson !== undefined ? { last_lesson: data.last_lesson } : {}),
      ...(data.quiz_scores !== undefined ? { quiz_scores: data.quiz_scores } : {}),
      ...(data.tour_done !== undefined ? { tour_done: data.tour_done } : {}),
    };
    const { error } = await context.supabase
      .from("academy_progress")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
