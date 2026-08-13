// Server-only helper for creating notifications from trusted internal code
// (server functions, webhooks, cron jobs). Uses the service role client and
// bypasses RLS, so callers must have already authorized the write.

export type NotificationKind =
  | "info"
  | "signal"
  | "alert"
  | "price"
  | "scanner"
  | "trade"
  | "system";

export interface CreateNotificationInput {
  userId: string;
  kind?: NotificationKind;
  title: string;
  body?: string | null;
  url?: string | null;
  meta?: Record<string, unknown>;
}

export async function createNotification(input: CreateNotificationInput) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: input.userId,
      kind: input.kind ?? "info",
      title: input.title,
      body: input.body ?? null,
      url: input.url ?? null,
      meta: (input.meta ?? {}) as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Create a notification at most once per dedupe key for a user. Used by
 * progress, social, and system notices so a page that re-renders (or a cron
 * that re-runs) cannot spam the inbox.
 *
 * `withinHours` limits the lookback: pass it for recurring notices that should
 * be allowed again later (e.g. a daily system warning), and leave it undefined
 * for one-time milestones.
 */
export async function createNotificationOnce(
  dedupe: string,
  input: CreateNotificationInput,
  withinHours?: number,
): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let q = supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("user_id", input.userId)
    .eq("meta->>dedupe", dedupe)
    .limit(1);
  if (withinHours) {
    q = q.gte("created_at", new Date(Date.now() - withinHours * 3600_000).toISOString());
  }
  const { data: existing } = await q;
  if (existing && existing.length > 0) return null;
  return createNotification({ ...input, meta: { ...(input.meta ?? {}), dedupe } });
}
