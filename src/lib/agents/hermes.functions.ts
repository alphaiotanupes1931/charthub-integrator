// Client-callable server functions for the Hermes learning agent.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { distillLessonFromFeedback, type HermesLessonRow } from "./hermes.server";

const FeedbackInput = z.object({
  kind: z.enum(["scan", "chat", "strategy"]),
  ticker: z.string().max(20).optional().nullable(),
  interval: z.string().max(4).optional().nullable(),
  lens: z.string().max(60).optional().nullable(),
  coach: z.string().max(40).optional().nullable(),
  rating: z.union([z.literal(-1), z.literal(1)]),
  note: z.string().max(600).optional().nullable(),
  context: z.record(z.string(), z.unknown()).default({}),
});

export const recordHermesFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => FeedbackInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };

    const { data: fb, error } = await supabase
      .from("hermes_feedback")
      .insert({
        user_id: userId,
        kind: data.kind,
        ticker: data.ticker ?? null,
        interval: data.interval ?? null,
        lens: data.lens ?? null,
        coach: data.coach ?? null,
        rating: data.rating,
        note: data.note ?? null,
        context: data.context,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Distil in the background; don't block the user gesture.
    const apiKey = process.env.LOVABLE_API_KEY;
    if (apiKey) {
      const distilled = await distillLessonFromFeedback(apiKey, {
        kind: data.kind, ticker: data.ticker, interval: data.interval,
        lens: data.lens, coach: data.coach,
        rating: data.rating, note: data.note ?? null,
        context: data.context,
      });
      if (distilled) {
        await supabase.from("hermes_lessons").insert({
          user_id: userId,
          scope: "user", // always store as user-scoped; global lessons are curated
          topic: distilled.topic,
          lesson: distilled.lesson,
          weight: data.rating === 1 ? 2 : 1,
          source_feedback_id: fb.id,
        });
      }
    }
    return { ok: true };
  });

const LessonsQueryInput = z.object({
  topics: z.array(z.string().max(60)).max(10).default([]),
  limit: z.number().int().min(1).max(30).default(12),
});

export const getHermesLessons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => LessonsQueryInput.parse(raw))
  .handler(async ({ data, context }): Promise<HermesLessonRow[]> => {
    const { supabase, userId } = context as { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };
    let q = supabase
      .from("hermes_lessons")
      .select("id,user_id,scope,topic,lesson,weight,created_at")
      .or(`user_id.eq.${userId},user_id.is.null`)
      .order("weight", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.topics.length) q = q.in("topic", data.topics);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as HermesLessonRow[];
  });

// Soft-auth: dashboard access is currently open, so return empty data when
// the caller has no session instead of throwing "Unauthorized".
async function getSoftAuthedClient() {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const auth = getRequestHeader("authorization");
  if (!auth) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { supabase, userId: data.user.id };
}

export const listMyLessons = createServerFn({ method: "GET" })
  .handler(async (): Promise<HermesLessonRow[]> => {
    const ctx = await getSoftAuthedClient();
    if (!ctx) return [];
    const { data, error } = await ctx.supabase
      .from("hermes_lessons")
      .select("id,user_id,scope,topic,lesson,weight,created_at")
      .or(`user_id.eq.${ctx.userId},user_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as HermesLessonRow[];
  });

const DeleteInput = z.object({ id: z.string().uuid() });
export const forgetLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => DeleteInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: import("@supabase/supabase-js").SupabaseClient };
    const { error } = await supabase.from("hermes_lessons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type HermesStats = { helpful: number; unhelpful: number; total: number; accuracy: number | null };
export const getHermesStats = createServerFn({ method: "GET" })
  .handler(async (): Promise<HermesStats> => {
    const ctx = await getSoftAuthedClient();
    if (!ctx) return { helpful: 0, unhelpful: 0, total: 0, accuracy: null };
    const { data, error } = await ctx.supabase
      .from("hermes_feedback")
      .select("rating")
      .eq("user_id", ctx.userId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ rating: number }>;
    const helpful = rows.filter((r) => r.rating > 0).length;
    const unhelpful = rows.filter((r) => r.rating < 0).length;
    const total = helpful + unhelpful;
    const accuracy = total > 0 ? Math.round((helpful / total) * 100) : null;
    return { helpful, unhelpful, total, accuracy };
  });
