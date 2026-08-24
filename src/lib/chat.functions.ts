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
  .inputValidator((d: unknown) => {
    const parsed = z.object({ archived: z.boolean().optional() }).safeParse(d ?? {});
    return parsed.success ? parsed.data : {};
  })
  .handler(async ({ data }) => {
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

    // Retention: archived threads are kept but hidden from the active History
    // list unless the caller explicitly asks for the archive.
    let query = supabase
      .from("chat_threads")
      .select("id,title,updated_at,created_at,archived_at")
      .eq("user_id", userId);
    query = data?.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    const { data: threads, error } = await query.order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = threads ?? [];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id as string);
    const { data: msgs } = await supabase
      .from("chat_messages")
      .select("thread_id,role,parts,created_at")
      .in("thread_id", ids)
      .order("created_at", { ascending: false })
      .limit(2000);

    const SYMBOL_RE = /\b(XAU\/?USD|XAG\/?USD|BTC(?:\/?USD)?|ETH(?:\/?USD)?|EUR\/?USD|GBP\/?USD|USD\/?JPY|AUD\/?USD|NZD\/?USD|USD\/?CAD|USD\/?CHF|NAS100|US30|SPX500|SPY|QQQ|DIA|NDX|GSPC|DJI|[A-Z]{2,5}\/[A-Z]{3,5})\b/i;
    const GRADE_RE = /\bGrade[:\s]*([A-DF][+-]?)\b|\b([A-DF][+-])\b/;
    const NICE: Record<string, string> = {
      XAUUSD: "XAU Gold", "XAU/USD": "XAU Gold",
      XAGUSD: "XAG Silver", "XAG/USD": "XAG Silver",
      BTC: "BTC", BTCUSD: "BTC", "BTC/USD": "BTC",
      ETH: "ETH", ETHUSD: "ETH", "ETH/USD": "ETH",
      NAS100: "NAS100", NDX: "NAS100", QQQ: "NAS100",
      US30: "US30", DJI: "US30", DIA: "US30",
      SPX500: "SPX500", GSPC: "SPX500", SPY: "SPX500",
    };
    const acc: Record<string, { first?: string; symbol?: string; grade?: string; scanned?: boolean }> = {};
    const uiMessageText = (parts: unknown): string => {
      if (!Array.isArray(parts)) return "";
      return (parts as Array<{ type?: string; text?: string; delta?: string }>)
        .map((p) => {
          if (p?.type === "text") return p.text ?? "";
          if (p?.type === "text-delta") return p.delta ?? "";
          return "";
        })
        .join("");
    };
    // Iterate oldest→newest so "first" user text is captured, latest symbol/grade wins.
    const ordered = (msgs ?? []).slice().reverse() as Array<{ thread_id: string; role: string; parts: unknown }>;
    for (const m of ordered) {
      const tid = m.thread_id;
      const text = uiMessageText(m.parts).replace(/\s+/g, " ").trim();
      if (!text) continue;
      const entry = acc[tid] ?? (acc[tid] = {});
      if (!entry.first && m.role === "user") entry.first = text.slice(0, 80);
      const sym = text.match(SYMBOL_RE)?.[0];
      if (sym) entry.symbol = sym.toUpperCase().replace("/", "");
      const g = text.match(GRADE_RE);
      if (g) entry.grade = (g[1] ?? g[2] ?? "").toUpperCase();
      if (/\bscan\b|\bReading:\s/i.test(text)) entry.scanned = true;
    }

    return rows.map((r) => {
      const a = acc[r.id as string] ?? {};
      const title = (r.title as string) ?? "";
      // Also scan the thread's own title so instrument-titled chats (created
      // from the dashboard before any message is sent) are recognized.
      const titleSym = title.match(SYMBOL_RE)?.[0];
      const symKey = a.symbol ?? (titleSym ? titleSym.toUpperCase().replace("/", "") : null);
      const nice = symKey ? (NICE[symKey] ?? symKey) : null;
      // Prefer, in order: friendly symbol name, a non-generic thread title,
      // then the first user message. Never fall back to bare chatter like "yo".
      const isGenericTitle = !title || /^(new conversation|dashboard scans)$/i.test(title);
      const preview = nice || (!isGenericTitle ? title : "") || a.first || "";
      return {
        ...r,
        preview,
        symbol: nice,
      };
    });
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
      .select("id,msg_id,role,parts,created_at")
      .eq("user_id", context.userId)
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    // Only true duplicates (the same stored message id) are collapsed. Content
    // dedupe used to silently drop repeat scans of the same instrument, which
    // made past scans disappear from history.
    const seen = new Set<string>();
    return (rows ?? [])
      .map((r) => ({
        // Reuse the original message id so the next turn re-saves the same row
        // instead of writing a duplicate copy of the history.
        id: ((r as { msg_id?: string | null }).msg_id ?? (r.id as string)) as string,
        role: r.role as "user" | "assistant" | "system",
        parts: (r.parts ?? []) as Array<{ type: string; text?: string }>,
      }))
      .filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
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

/**
 * Saves an assistant message the client generated locally (the Analysis engine's
 * grade card injected into the chat) so reopening the thread from history still
 * shows the full setup instead of just the coach prose.
 */
export const appendAssistantChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ threadId: z.string().uuid(), text: z.string().min(1).max(20000), msgId: z.string().max(120).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("chat_messages").upsert({
      thread_id: data.threadId,
      user_id: context.userId,
      client_id: context.userId,
      msg_id: data.msgId ?? null,
      role: "assistant",
      parts: [{ type: "text", text: data.text }] as never,
    } as never, { onConflict: "thread_id,msg_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  });




export type ActiveModelInfo = { provider: "claude" | "gemini"; model: string; label: string };

export const getActiveModel = createServerFn({ method: "GET" })
  .handler(async () => {
    const gemini = { provider: "gemini", model: "google/gemini-2.5-flash", label: "Google Gemini" } as ActiveModelInfo;
    if (!process.env.ANTHROPIC_API_KEY) return gemini;
    // A present key is not enough: an out-of-credits Anthropic account still has
    // a valid key, and the coach is answering on Gemini in that case.
    try {
      const { probeClaude } = await import("@/lib/ai-credits.server");
      const probe = await probeClaude();
      if (probe.status !== "ok") return gemini;
    } catch {
      return gemini;
    }
    return { provider: "claude", model: "claude-sonnet-4-5", label: "Claude Sonnet" } as ActiveModelInfo;
  });

