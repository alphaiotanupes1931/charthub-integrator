// News + economic calendar for the app (Forex Factory feed).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type NewsPayload = {
  events: {
    title: string;
    country: string;
    date: string;
    impact: string;
    forecast: string;
    previous: string;
    actual?: string;
  }[];
  writeup: string | null;
  fetchedAt: string;
};

export const getMarketNews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        withWriteup: z.boolean().default(true),
        watchlist: z.array(z.string().min(1).max(30)).max(20).default([]),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<NewsPayload> => {
    const { fetchCalendar, todaysEvents, highImpactAhead, writeNewsBriefing } = await import("@/lib/news.server");
    const all = await fetchCalendar();
    const today = todaysEvents(all);
    const ahead = highImpactAhead(all, 48);
    const seen = new Set<string>();
    const events = [...today, ...ahead].filter((e) => {
      const k = `${e.date}|${e.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const writeup = data.withWriteup
      ? await writeNewsBriefing(events.filter((e) => /high|medium/i.test(e.impact)), data.watchlist)
      : null;
    return { events, writeup, fetchedAt: new Date().toISOString() };
  });
