import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RETENTION_VALUES } from "@/lib/retention";

/**
 * Scan history retention.
 *
 * Users pick how long scan conversations and their grade cards stay in the
 * active History list. Expired threads are ARCHIVED, never deleted: they drop
 * out of History but can be restored at any time from the Archived view.
 * A nightly job applies the same rule server-side.
 */


export const getRetentionSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("scan_retention_days")
      .eq("id", context.userId)
      .maybeSingle();

    const { count: archivedCount } = await context.supabase
      .from("chat_threads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .not("archived_at", "is", null);

    return {
      retentionDays: profile?.scan_retention_days ?? 0,
      archivedCount: archivedCount ?? 0,
    };
  });

export const setRetentionSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        retentionDays: z.number().int().refine((v) => RETENTION_VALUES.includes(v), "Unsupported retention window"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ scan_retention_days: data.retentionDays })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, retentionDays: data.retentionDays };
  });

/** Archives the caller's own threads that already fall outside their window. */
export const applyRetentionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("scan_retention_days")
      .eq("id", context.userId)
      .maybeSingle();
    const days = profile?.scan_retention_days ?? 0;
    if (!days) return { archived: 0 };

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("chat_threads")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("archived_at", null)
      .lt("updated_at", cutoff)
      .select("id");
    if (error) throw new Error(error.message);
    return { archived: rows?.length ?? 0 };
  });

export const setThreadArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ threadId: z.string().uuid(), archived: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_threads")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("user_id", context.userId)
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
