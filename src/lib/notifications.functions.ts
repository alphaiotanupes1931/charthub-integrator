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
  meta: Record<string, unknown>;
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
    const rows = (data ?? []) as NotificationRow[];
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
