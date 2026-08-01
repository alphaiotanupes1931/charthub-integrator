// User-facing briefing server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildBriefingBody, sendTelegramMessage, sendDiscordWebhook, sendDiscordShared } from "@/lib/briefings.server";

function randCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function ensurePrefs(supabase: any, userId: string) {
  const { data } = await supabase.from("briefing_prefs").select("*").eq("user_id", userId).maybeSingle();
  if (data) return data;
  const guessedTz = "UTC";
  const { data: created, error } = await supabase
    .from("briefing_prefs")
    .insert({ user_id: userId, timezone: guessedTz })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return created;
}

export const getBriefingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const prefs = await ensurePrefs(supabase, userId);
    const { data: history } = await supabase
      .from("briefings")
      .select("id,kind,title,body,delivered_telegram,delivered_discord,sent_at")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(30);
    const { data: signals } = await supabase
      .from("signal_feed")
      .select("id,symbol,grade,bias,action,entry,stop,tp1,rr,confidence,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    return { prefs, history: history ?? [], signals: signals ?? [] };
  });

const prefsInput = z.object({
  timezone: z.string().min(1).max(60).optional(),
  morning_enabled: z.boolean().optional(),
  evening_enabled: z.boolean().optional(),
  morning_hour: z.number().int().min(0).max(23).optional(),
  evening_hour: z.number().int().min(0).max(23).optional(),
  watchlist: z.array(z.string().min(1).max(30)).max(20).optional(),
});

export const updateBriefingPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => prefsInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await ensurePrefs(supabase, userId);
    const patch: Record<string, unknown> = {};
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.morning_enabled !== undefined) patch.morning_enabled = data.morning_enabled;
    if (data.evening_enabled !== undefined) patch.evening_enabled = data.evening_enabled;
    if (data.morning_hour !== undefined) patch.morning_hour = data.morning_hour;
    if (data.evening_hour !== undefined) patch.evening_hour = data.evening_hour;
    if (data.watchlist !== undefined) patch.watchlist = data.watchlist;
    const { error } = await (supabase.from("briefing_prefs") as any).update(patch).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateTelegramLinkCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await ensurePrefs(supabase, userId);
    const code = randCode();
    const { error } = await supabase
      .from("briefing_prefs")
      .update({ telegram_link_code: code })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { code };
  });

export const unlinkTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("briefing_prefs")
      .update({ telegram_chat_id: null, telegram_link_code: null })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setDiscordWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({
      webhook_url: z.string().url().max(500).regex(/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//, "Must be a Discord webhook URL"),
    }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await ensurePrefs(supabase, userId);
    // Send a test ping so user sees it worked immediately.
    const test = await sendDiscordWebhook(data.webhook_url, "TradeMind Discord notifications are now linked to this channel.");
    if (!test.ok) throw new Error(`Discord test failed: ${test.error}`);
    const { error } = await supabase
      .from("briefing_prefs")
      .update({ discord_webhook_url: data.webhook_url })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unlinkDiscord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("briefing_prefs")
      .update({ discord_webhook_url: null })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendBriefingNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ kind: z.enum(["morning", "evening", "ad_hoc"]).default("ad_hoc") }).parse(raw))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const prefs = await ensurePrefs(supabase, userId);
    const { data: acct } = await supabase.from("paper_accounts").select("balance,peak_equity,status,testing_mode").eq("user_id", userId).maybeSingle();
    let paperSummary: string | null = null;
    if (acct?.testing_mode) {
      paperSummary = `Balance $${Number(acct.balance).toFixed(2)} · Peak $${Number(acct.peak_equity).toFixed(2)} · Status ${acct.status}`;
    }
    const { title, body } = await buildBriefingBody(data.kind, prefs.watchlist ?? [], paperSummary);
    const msg = `${title}\n\n${body}`;
    let delivered_telegram = false;
    let delivered_discord = false;
    if (prefs.telegram_chat_id) {
      const r = await sendTelegramMessage(prefs.telegram_chat_id, msg);
      delivered_telegram = r.ok;
    }
    if ((prefs as any).discord_webhook_url) {
      const r = await sendDiscordWebhook((prefs as any).discord_webhook_url, `**${title}**\n${body}`);
      delivered_discord = r.ok;
    }
    // Also fan out morning/evening briefings to the shared community feed (if configured).
    if (data.kind !== "ad_hoc") {
      await sendDiscordShared(`**${title}**\n${body}`).catch(() => undefined);
    }
    const { data: row, error } = await (supabase.from("briefings") as any).insert({
      user_id: userId,
      kind: data.kind,
      title,
      body,
      delivered_telegram,
      delivered_discord,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return { briefing: row, delivered: delivered_telegram || delivered_discord, delivered_telegram, delivered_discord };
  });
