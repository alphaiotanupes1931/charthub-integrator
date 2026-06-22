import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { UIMessage } from "ai";

function db() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

const ClientIdInput = z.object({ clientId: z.string().min(8) });

export const listChatThreads = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ClientIdInput.parse(d))
  .handler(async ({ data }) => {
    const { data: rows, error } = await db()
      .from("chat_threads")
      .select("id,title,updated_at,created_at")
      .eq("client_id", data.clientId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createChatThread = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ clientId: z.string().min(8), title: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { data: row, error } = await db()
      .from("chat_threads")
      .insert({ client_id: data.clientId, title: data.title || "New conversation" })
      .select("id,title,updated_at,created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteChatThread = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ clientId: z.string().min(8), threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await db()
      .from("chat_threads")
      .delete()
      .eq("client_id", data.clientId)
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getChatMessages = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ clientId: z.string().min(8), threadId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<UIMessage[]> => {
    const { data: rows, error } = await db()
      .from("chat_messages")
      .select("id,role,parts,created_at")
      .eq("client_id", data.clientId)
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      role: r.role as UIMessage["role"],
      parts: (r.parts as UIMessage["parts"]) ?? [],
    }));
  });

export const renameChatThread = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ clientId: z.string().min(8), threadId: z.string().uuid(), title: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await db()
      .from("chat_threads")
      .update({ title: data.title })
      .eq("client_id", data.clientId)
      .eq("id", data.threadId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
