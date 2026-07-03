import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

function getBearerToken() {
  const auth = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
  return auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
}

export const listChatThreads = createServerFn({ method: "POST" })
  .handler(async () => {
    // Auth-optional while the app is open for testing: no session means no saved history.
    const token = getBearerToken();
    if (!token) return [];

    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );

    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData.user?.id;
    if (!userId) return [];

    const { data, error } = await supabase
      .from("chat_threads")
      .select("id,title,updated_at,created_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getOrCreateDashboardThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const title = "Dashboard scans";
    const { data: existing } = await context.supabase
      .from("chat_threads")
      .select("id,title,updated_at,created_at")
      .eq("user_id", context.userId)
      .eq("title", title)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;
    const { data: row, error } = await context.supabase
      .from("chat_threads")
      .insert({ user_id: context.userId, client_id: context.userId, title })
      .select("id,title,updated_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const createChatThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ title: z.string().max(80).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("chat_threads")
      .insert({
        user_id: context.userId,
        client_id: context.userId, // legacy NOT NULL column
        title: data.title || "New conversation",
      })
      .select("id,title,updated_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteChatThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_threads")
      .delete()
      .eq("user_id", context.userId)
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getChatMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_messages")
      .select("id,role,parts,created_at")
      .eq("user_id", context.userId)
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      role: r.role as "user" | "assistant" | "system",
      parts: (r.parts ?? []) as Array<{ type: string; text?: string }>,
    }));
  });

export const renameChatThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ threadId: z.string().uuid(), title: z.string().trim().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_threads")
      .update({ title: data.title })
      .eq("user_id", context.userId)
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
