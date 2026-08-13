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

    // Progress notifications: fire once per milestone (module finished,
    // certificate ready, whole academy done). Never blocks the save.
    if (data.completed) {
      try {
        await notifyAcademyMilestones(context.userId, data.completed);
      } catch (e) {
        console.warn("[academy] milestone_notify_failed", (e as Error).message);
      }
    }
    return { ok: true };
  });

async function notifyAcademyMilestones(userId: string, completed: Record<string, true>) {
  const [{ ACADEMY }, { createNotificationOnce }] = await Promise.all([
    import("@/lib/academy-content"),
    import("@/lib/notifications.server"),
  ]);

  let modulesDone = 0;
  for (const mod of ACADEMY) {
    const lessons = mod.lessons.map((l) => l.id);
    const done = lessons.every((id) => completed[id]);
    if (!done) continue;
    modulesDone += 1;
    await createNotificationOnce(`academy:module:${mod.id}`, {
      userId,
      kind: "info",
      title: `Module ${mod.id} complete: ${mod.title}`,
      body: "Your certificate for this module is ready to view.",
      url: `/academy/certificate/${mod.id}`,
    });
  }

  if (modulesDone === ACADEMY.length && ACADEMY.length > 0) {
    await createNotificationOnce("academy:master", {
      userId,
      kind: "info",
      title: "Academy complete",
      body: "Every module is finished. Your master certificate is ready.",
      url: "/academy/master-certificate",
    });
  }
}
