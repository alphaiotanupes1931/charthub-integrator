import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const EMPTY = {
  displayName: null,
  email: null,
  threadTitle: null,
  threadUpdatedAt: null,
  lastAssistant: null,
  lastUser: null,
} as const;

export const getLatestRecapContext = createServerFn({ method: "POST" }).handler(
  async () => {
    // Auth-optional: if the caller isn't signed in, return an empty recap
    // instead of throwing (dashboard is currently open to everyone for testing).
    const auth = getRequestHeader("authorization") ?? getRequestHeader("Authorization");
    const token = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
    if (!token) return EMPTY;

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
    if (!userId) return EMPTY;

    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name,email")
      .eq("id", userId)
      .maybeSingle();

    const { data: thread } = await supabase
      .from("chat_threads")
      .select("id,title,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let lastAssistant: string | null = null;
    let lastUser: string | null = null;
    if (thread?.id) {
      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("role,parts,created_at")
        .eq("user_id", userId)
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
      displayName: profile?.display_name ?? null,
      email: profile?.email ?? null,
      threadTitle: thread?.title ?? null,
      threadUpdatedAt: thread?.updated_at ?? null,
      lastAssistant,
      lastUser,
    };
  },
);
