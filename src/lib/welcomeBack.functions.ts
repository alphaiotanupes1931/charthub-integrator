import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getLatestRecapContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: thread } = await context.supabase
      .from("chat_threads")
      .select("id,title,updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let lastAssistant: string | null = null;
    let lastUser: string | null = null;
    if (thread?.id) {
      const { data: msgs } = await context.supabase
        .from("chat_messages")
        .select("role,parts,created_at")
        .eq("user_id", context.userId)
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: false })
        .limit(8);
      for (const m of msgs ?? []) {
        const parts = (m.parts ?? []) as Array<{ type: string; text?: string }>;
        const text = parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text!)
          .join(" ")
          .trim();
        if (!text) continue;
        if (!lastAssistant && m.role === "assistant") lastAssistant = text;
        if (!lastUser && m.role === "user") lastUser = text;
        if (lastAssistant && lastUser) break;
      }
    }

    return {
      threadTitle: thread?.title ?? null,
      threadUpdatedAt: thread?.updated_at ?? null,
      lastAssistant,
      lastUser,
    };
  });
