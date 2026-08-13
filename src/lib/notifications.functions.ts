// Client-callable server functions for the in-app notification inbox.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  meta: Record<string, string | number | boolean | null>;
  read_at: string | null;
  created_at: string;
}

type Ctx = { supabase: SupabaseClient; userId: string };

export const listMyNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as Ctx;
    const { data, error } = await supabase
      .from("notifications")
      .select("id, kind, title, body, url, meta, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as NotificationRow[]).map((r) => ({
      ...r,
      meta: (r.meta ?? {}) as NotificationRow["meta"],
    }));
    const unread = rows.filter((r) => !r.read_at).length;
    return { rows, unread };
  });

const IdInput = z.object({ id: z.string().uuid() });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => IdInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearReadNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("user_id", userId)
      .not("read_at", "is", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Dev/test helper: create a notification for the calling user.
const CreateInput = z.object({
  kind: z.string().max(40).default("info"),
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional().nullable(),
  url: z.string().max(500).optional().nullable(),
});

export const createTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CreateInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as Ctx;
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      kind: data.kind,
      title: data.title,
      body: data.body ?? null,
      url: data.url ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Account and system notices raised by the app itself (backup AI model in use,
 * broker connection lost, a scan that failed). Only a fixed set of reasons is
 * accepted so the client cannot write arbitrary inbox rows, and each reason is
 * deduped to once per day.
 */
const SYSTEM_NOTICES = {
  ai_backup_model: {
    title: "AI coach is on the backup model",
    body: "Claude credits ran out, so your coach is answering on Google Gemini. Replies still work; contact admin to top up.",
    url: "/dashboard",
    perHours: 24,
  },
  ai_unavailable: {
    title: "AI coach is temporarily unavailable",
    body: "The chat could not reach a model. Try again in a few minutes; if it keeps failing, contact admin.",
    url: "/dashboard",
    perHours: 6,
  },
  broker_disconnected: {
    title: "Broker connection needs attention",
    body: "Your broker link expired or was rejected. Reconnect it to keep live prices and order routing working.",
    url: "/settings",
    perHours: 24,
  },
  scan_failed: {
    title: "A scan could not complete",
    body: "The scanner could not finish the last run. This is usually a temporary data feed hiccup - run it again.",
    url: "/dashboard",
    perHours: 6,
  },
} as const;

export const reportSystemNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      reason: z.enum(["ai_backup_model", "ai_unavailable", "broker_disconnected", "scan_failed"]),
      detail: z.string().max(300).optional(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as Ctx;
    const notice = SYSTEM_NOTICES[data.reason];
    const { createNotificationOnce } = await import("@/lib/notifications.server");
    const day = new Date().toISOString().slice(0, 10);
    const id = await createNotificationOnce(
      `system:${data.reason}:${day}`,
      {
        userId,
        kind: "system",
        title: notice.title,
        body: data.detail ? `${notice.body} (${data.detail})` : notice.body,
        url: notice.url,
        meta: { reason: data.reason },
      },
      notice.perHours,
    );
    return { created: !!id };
  });
