// Briefing generator + Telegram delivery. Server-only.
import { getSnapshot } from "@/lib/agents/market-data.server";
import type { MarketSnapshot } from "@/lib/agents/types";

export type BriefingKind = "morning" | "evening" | "ad_hoc";

const DEFAULT_WATCHLIST = ["XAU/USD", "EUR/USD", "^GSPC", "^NDX"];

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
  const symbols = watchlist.length ? watchlist : DEFAULT_WATCHLIST;
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
