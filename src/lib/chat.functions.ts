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

    const { data: threads, error } = await supabase
      .from("chat_threads")
      .select("id,title,updated_at,created_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
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
    // Iterate oldest→newest so "first" user text is captured, latest symbol/grade wins.
    const ordered = (msgs ?? []).slice().reverse() as Array<{ thread_id: string; role: string; parts: unknown }>;
    for (const m of ordered) {
      const tid = m.thread_id;
      const parts = Array.isArray(m.parts) ? (m.parts as Array<{ type?: string; text?: string }>) : [];
      const text = parts.map((p) => (p?.type === "text" ? p.text ?? "" : "")).join(" ").replace(/\s+/g, " ").trim();
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
      const nice = a.symbol ? (NICE[a.symbol] ?? a.symbol) : null;
      return {
        ...r,
        preview: nice || a.first || "",
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
