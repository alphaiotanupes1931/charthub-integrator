// Briefing generator + Telegram delivery. Server-only.
import { getSnapshot } from "@/lib/agents/market-data.server";
import type { MarketSnapshot } from "@/lib/agents/types";

export type BriefingKind = "morning" | "evening" | "ad_hoc";

// Briefings cover every instrument TradeMind tracks. No per-user watchlist.
const ALL_INSTRUMENTS = [
  "XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD", "USD/JPY",
  "NAS100", "SPX500", "US30", "WTI Oil", "BTC/USD", "ETH/USD",
];

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "n/a";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(n: number) {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}%`;
}

async function fetchSnapshotSafe(sym: string, interval: string): Promise<MarketSnapshot | null> {
  try {
    const s = await getSnapshot(sym, interval);
    if (s.source === "unavailable") return null;
    return s;
  } catch {
    return null;
  }
}

export async function buildBriefingBody(
  kind: BriefingKind,
  watchlist: string[],
  paperSummary: string | null,
): Promise<{ title: string; body: string }> {
  void watchlist; // briefings always cover the full instrument list
  const symbols = ALL_INSTRUMENTS;
  const interval = kind === "morning" ? "60" : "15";
  const snaps = await Promise.all(symbols.map(s => fetchSnapshotSafe(s, interval)));

  const lines: string[] = [];
  const title = kind === "morning" ? "Morning briefing" : kind === "evening" ? "Evening report" : "Market briefing";
  lines.push(title);
  lines.push("");
  for (let i = 0; i < symbols.length; i += 1) {
    const sym = symbols[i];
    const s = snaps[i];
    if (!s) { lines.push(`${sym}: data unavailable`); continue; }
    const change = s.stats.changePct24h;
    const range = s.stats.range20Pct;
    lines.push(`${sym}: ${fmt(s.lastPrice, 5)} (${pct(change)} 24h, ${range.toFixed(2)}% 20-bar range)`);
  }

  // Forex Factory economic calendar + AI write-up over it.
  try {
    const { fetchCalendar, todaysEvents, highImpactAhead, formatCalendarLines, writeNewsBriefing } = await import("@/lib/news.server");
    const all = await fetchCalendar();
    if (all.length) {
      const todayHi = todaysEvents(all).filter(e => /high|medium/i.test(e.impact));
      const scope = kind === "evening" ? highImpactAhead(all, 24) : (todayHi.length ? todayHi : highImpactAhead(all, 72));
      if (scope.length) {
        lines.push("");
        lines.push(kind === "evening" ? "Next 24h risk events (Forex Factory):" : "Today's risk events (Forex Factory):");
        for (const l of formatCalendarLines(scope, "UTC", 10)) lines.push(`- ${l}`);
      }
      const writeup = await writeNewsBriefing(scope.length ? scope : highImpactAhead(all, 72), symbols);
      if (writeup) {
        lines.push("");
        lines.push("News read:");
        lines.push(writeup);
      }
    }
  } catch {
    /* calendar is best effort */
  }

  // Recent A / A+ signals from the shared scanner feed.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: sigs } = await supabaseAdmin
      .from("signal_feed")
      .select("symbol,grade,action,entry,stop,tp1,rr,confidence,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8);
    if (sigs?.length) {
      lines.push("");
      lines.push("A / A+ signals in the last 24h:");
      for (const g of sigs as any[]) {
        lines.push(`- ${g.grade} ${g.action} ${g.symbol}: entry ${g.entry} stop ${g.stop} tp1 ${g.tp1} (R:R ${g.rr}, confidence ${g.confidence}%)`);
      }
    }
  } catch {
    /* signal feed is best effort */
  }

  if (paperSummary) {
    lines.push("");
    lines.push("Paper account:");
    lines.push(paperSummary);
  }

  lines.push("");
  lines.push(kind === "morning"
    ? "Plan your day. Look for A or A+ setups only."
    : "Log today's trades and mental state before you shut down.");

  return { title, body: lines.join("\n") };

}

// Telegram delivery via connector gateway.
export async function sendTelegramMessage(chatId: number | string, text: string): Promise<{ ok: boolean; error?: string }> {
  const gatewayKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!gatewayKey || !connKey) return { ok: false, error: "telegram_not_configured" };
  try {
    const res = await fetch("https://connector-gateway.lovable.dev/telegram/sendMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) return { ok: false, error: `${res.status}` };
    const j = await res.json() as { ok?: boolean; description?: string };
    if (!j.ok) return { ok: false, error: j.description ?? "telegram_error" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
}

// Discord delivery via webhook URL. Works with any incoming webhook URL
// generated in Discord (Server Settings → Integrations → Webhooks).
export async function sendDiscordWebhook(
  webhookUrl: string,
  content: string,
  username = "TradeMind",
): Promise<{ ok: boolean; error?: string }> {
  if (!webhookUrl || !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)) {
    return { ok: false, error: "invalid_webhook_url" };
  }
  try {
    // Discord max content = 2000 chars
    const trimmed = content.length > 1900 ? content.slice(0, 1900) + "…" : content;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: trimmed, username, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
}

// Shared community feed (single webhook set at project level).
export async function sendDiscordShared(content: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return { ok: false, error: "discord_shared_not_configured" };
  return sendDiscordWebhook(url, content);
}

// Local-time hour for a user's timezone.
export function currentHourInTZ(tz: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date());
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : new Date().getUTCHours();
  } catch {
    return new Date().getUTCHours();
  }
}
