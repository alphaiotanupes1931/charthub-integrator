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
      meta: input.meta ?? {},
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
