// Day review for the journal: every scan the trader ran that New York day,
// whether they took it, and what price did afterwards, plus that day's chats.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** UTC bounds of a New York calendar day (DST-safe to within the hour). */
function nyDayBounds(ymd: string): { from: string; to: string } {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const nyNoon = new Date(noonUtc.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = noonUtc.getTime() - nyNoon.getTime();
  const start = new Date(new Date(`${ymd}T00:00:00Z`).getTime() + offsetMs);
  return { from: start.toISOString(), to: new Date(start.getTime() + 86_400_000).toISOString() };
}

export const getJournalDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { from, to } = nyDayBounds(data.date);
    const [scans, threads] = await Promise.all([
      supabase
        .from("signal_scores")
        .select("id,symbol,timeframe,grade,bias,confidence,entry,stop,tp1,status,realized_r,taken,created_at")
        .eq("user_id", userId)
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("chat_threads")
        .select("id,title,updated_at")
        .eq("user_id", userId)
        .gte("updated_at", from)
        .lt("updated_at", to)
        .order("updated_at", { ascending: false })
        .limit(50),
    ]);
    return {
      scans: (scans.data ?? []).map((s) => ({
        id: s.id as string,
        symbol: s.symbol as string,
        timeframe: (s.timeframe as string | null) ?? null,
        grade: (s.grade as string | null) ?? null,
        bias: (s.bias as string | null) ?? null,
        entry: s.entry == null ? null : Number(s.entry),
        stop: s.stop == null ? null : Number(s.stop),
        tp1: s.tp1 == null ? null : Number(s.tp1),
        status: (s.status as string | null) ?? null,
        realizedR: s.realized_r == null ? null : Number(s.realized_r),
        taken: !!s.taken,
        at: s.created_at as string,
      })),
      chats: (threads.data ?? []).map((t) => ({ id: t.id as string, title: (t.title as string | null) ?? "Untitled chat" })),
    };
  });
