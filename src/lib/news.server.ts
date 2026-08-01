// Forex Factory economic calendar + AI news write-up. Server only.
// Source: Forex Factory's own weekly JSON feed (faireconomy mirror), which is
// what the calendar page on forexfactory.com renders from.

export type CalendarEvent = {
  title: string;
  country: string;
  date: string; // ISO
  impact: "High" | "Medium" | "Low" | "Holiday" | string;
  forecast: string;
  previous: string;
  actual?: string;
};

const HOSTS = ["https://nfs.faireconomy.media", "https://cdn-nfs.faireconomy.media"];
const WEEKS = ["ff_calendar_thisweek", "ff_calendar_nextweek"];

let cache: { at: number; events: CalendarEvent[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

function push(merged: CalendarEvent[], e: Partial<CalendarEvent>) {
  if (!e?.title || !e?.date) return;
  merged.push({
    title: String(e.title),
    country: String(e.country ?? ""),
    date: String(e.date),
    impact: String(e.impact ?? "Low"),
    forecast: String(e.forecast ?? ""),
    previous: String(e.previous ?? ""),
    actual: e.actual ? String(e.actual) : undefined,
  });
}

// Faireconomy also publishes the same calendar as XML. Used when the JSON
// mirror is unreachable or returns an empty body.
function parseFaireconomyXml(xml: string): Partial<CalendarEvent>[] {
  const out: Partial<CalendarEvent>[] = [];
  const tag = (block: string, name: string) => {
    const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i"));
    return m ? m[1].trim() : "";
  };
  for (const m of xml.matchAll(/<event>([\s\S]*?)<\/event>/gi)) {
    const b = m[1];
    const date = tag(b, "date");
    const time = tag(b, "time");
    if (!date) continue;
    // Feed dates look like "08-03-2026" (MM-DD-YYYY) with times like "8:30am".
    const [mm, dd, yyyy] = date.split("-");
    let hours = 0;
    let mins = 0;
    const t = time.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (t) {
      hours = Number(t[1]) % 12 + (/pm/i.test(t[3]) ? 12 : 0);
      mins = Number(t[2]);
    }
    const iso = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), hours, mins)).toISOString();
    out.push({
      title: tag(b, "title"),
      country: tag(b, "country"),
      date: iso,
      impact: tag(b, "impact") || "Low",
      forecast: tag(b, "forecast"),
      previous: tag(b, "previous"),
      actual: tag(b, "actual") || undefined,
    });
  }
  return out;
}

export async function fetchCalendar(): Promise<CalendarEvent[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.events;

  // This week plus next week, so the page and briefings are never blank over
  // a weekend when the current week's releases are all in the past.
  const merged: CalendarEvent[] = [];
  for (const week of WEEKS) {
    let got = false;
    for (const host of HOSTS) {
      if (got) break;
      for (const ext of ["json", "xml"] as const) {
        try {
          const res = await fetch(`${host}/${week}.${ext}`, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; TradeMind/1.0)",
              Accept: ext === "json" ? "application/json" : "application/xml,text/xml",
            },
          });
          if (!res.ok) continue;
          if (ext === "json") {
            const raw = (await res.json()) as CalendarEvent[];
            if (!Array.isArray(raw) || raw.length === 0) continue;
            for (const e of raw) push(merged, e);
          } else {
            const rows = parseFaireconomyXml(await res.text());
            if (!rows.length) continue;
            for (const e of rows) push(merged, e);
          }
          got = true;
          break;
        } catch {
          /* try next format / mirror */
        }
      }
    }
  }
  // Keep serving the last good copy rather than going blank when every mirror fails.
  if (!merged.length) return cache?.events ?? [];
  merged.sort((a, b) => a.date.localeCompare(b.date));
  cache = { at: Date.now(), events: merged };
  return merged;
}


function sameUtcDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10) === ref.toISOString().slice(0, 10);
}

export function todaysEvents(events: CalendarEvent[], ref = new Date()): CalendarEvent[] {
  return events.filter((e) => sameUtcDay(e.date, ref)).sort((a, b) => a.date.localeCompare(b.date));
}

export function highImpactAhead(
  events: CalendarEvent[],
  hours = 24,
  ref = new Date(),
): CalendarEvent[] {
  const until = ref.getTime() + hours * 3600_000;
  return events
    .filter((e) => {
      const t = new Date(e.date).getTime();
      return t >= ref.getTime() && t <= until && /high|medium/i.test(e.impact);
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Currencies that matter for a given instrument, so the coach only sees
// releases that can actually move what is on the chart.
export function currenciesFor(symbol: string): string[] {
  const s = symbol.toUpperCase();
  const out = new Set<string>();
  for (const ccy of ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"]) {
    if (s.includes(ccy)) out.add(ccy);
  }
  if (/XAU|GOLD|XAG|SILVER|NAS|SPX|US30|DJI|NDX|GSPC|BTC|ETH|OIL|WTI/.test(s)) out.add("USD");
  if (out.size === 0) out.add("USD");
  return [...out];
}

export function formatCalendarLines(events: CalendarEvent[], tz = "UTC", limit = 12): string[] {
  const fmt = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return new Date(iso).toISOString().slice(11, 16);
    }
  };
  return events.slice(0, limit).map((e) => {
    const bits = [
      `${fmt(e.date)} ${e.country} ${e.impact.toUpperCase()}: ${e.title}`,
      e.actual ? `actual ${e.actual}` : "",
      e.forecast ? `forecast ${e.forecast}` : "",
      e.previous ? `previous ${e.previous}` : "",
    ].filter(Boolean);
    return bits.join(" · ");
  });
}

// Compact block injected into the AI system prompt.
export async function calendarContextBlock(symbol?: string): Promise<string | undefined> {
  const all = await fetchCalendar();
  if (!all.length) return undefined;
  const wanted = symbol ? currenciesFor(symbol) : [];
  const relevant = (list: CalendarEvent[]) =>
    wanted.length ? list.filter((e) => wanted.includes(e.country.toUpperCase())) : list;

  const today = relevant(todaysEvents(all)).filter((e) => /high|medium/i.test(e.impact));
  const ahead = relevant(highImpactAhead(all, 72));
  const now = Date.now();
  const recent = relevant(
    all.filter((e) => new Date(e.date).getTime() <= now && /high|medium/i.test(e.impact)),
  ).slice(-6);
  if (!today.length && !ahead.length && !recent.length) return undefined;

  const lines: string[] = ["ECONOMIC CALENDAR (Forex Factory, times in UTC)"];
  if (today.length) {
    lines.push("Today:");
    lines.push(...formatCalendarLines(today, "UTC", 10).map((l) => `- ${l}`));
  }
  if (ahead.length) {
    lines.push("Next 72 hours:");
    lines.push(...formatCalendarLines(ahead, "UTC", 10).map((l) => `- ${l}`));
  }
  if (!today.length && !ahead.length && recent.length) {
    lines.push("Most recent releases (nothing scheduled in the next 72 hours):");
    lines.push(...formatCalendarLines(recent, "UTC", 6).map((l) => `- ${l}`));
  }
  lines.push(
    "Use this when judging timing and risk. Warn the trader when a high-impact release lands inside the trade window. Never invent releases that are not listed here.",
  );
  return lines.join("\n");
}

// AI narrative over the calendar, used inside briefings and the News tab.
export async function writeNewsBriefing(
  events: CalendarEvent[],
  watchlist: string[],
): Promise<string | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const gatewayKey = process.env.LOVABLE_API_KEY;
  if (!anthropicKey && !gatewayKey) return null;
  if (!events.length) return null;

  const list = formatCalendarLines(events, "UTC", 20).join("\n");
  const prompt = [
    "You are a trading desk analyst writing a short pre-session note for a retail trader.",
    `Their watchlist: ${watchlist.length ? watchlist.join(", ") : "XAU/USD, EUR/USD, indices"}.`,
    "Economic calendar for the session (Forex Factory, UTC):",
    list,
    "",
    "Write 4 to 6 plain sentences: what the session's risk events are, which watchlist instruments they hit, and what a disciplined trader should do around those times (stand aside, tighten risk, wait for the reaction). No hype, no price predictions, no percentages of confidence, no emoji, no em dashes or en dashes. If the calendar is quiet, say so plainly.",
  ].join("\n");

  try {
    const { generateText } = await import("ai");
    let model: Parameters<typeof generateText>[0]["model"];
    if (anthropicKey) {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      model = createAnthropic({ apiKey: anthropicKey })(
        "claude-sonnet-4-5",
      ) as unknown as Parameters<typeof generateText>[0]["model"];
    } else {
      const { createAiGatewayProvider } = await import("@/lib/ai-gateway.server");
      model = createAiGatewayProvider(gatewayKey!)(
        "google/gemini-2.5-flash",
      ) as unknown as Parameters<typeof generateText>[0]["model"];
    }
    const { text } = await generateText({ model, prompt, maxRetries: 1 });
    const clean = text.replace(/[\u2013\u2014]/g, "-").trim();
    return clean || null;
  } catch {
    return null;
  }
}
