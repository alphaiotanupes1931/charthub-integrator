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
    const { fetchCalendar, todaysEvents, highImpactAhead, writeNewsBriefing } =
      await import("@/lib/news.server");
    const all = await fetchCalendar();
    const today = todaysEvents(all);
    // Today plus everything still ahead in the next 7 days, so weekends and
    // quiet sessions still show what is coming.
    const ahead = highImpactAhead(all, 24 * 7);
    const seen = new Set<string>();
    const events = [...today, ...ahead]
      .filter((e) => {
        const k = `${e.date}|${e.title}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // Weekend or end of the published week: nothing is ahead, so show the last
    // session's releases with their actuals instead of an empty page.
    const now = Date.now();
    const list = events.length
      ? events
      : all.filter((e) => new Date(e.date).getTime() <= now).slice(-20);

    const writeup = data.withWriteup
      ? await writeNewsBriefing(
          list.filter((e) => /high|medium/i.test(e.impact)).slice(0, 20),
          data.watchlist,
        )
      : null;
    return { events: list, writeup, fetchedAt: new Date().toISOString() };
  });
