import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getMarketNews } from "@/lib/news.functions";
import { getBriefingState } from "@/lib/briefings.functions";
import { useTimezone } from "@/hooks/useTimezone";

export const Route = createFileRoute("/_app/news")({
  head: () => ({
    meta: [
      { title: "Market news and economic calendar, TradeMind" },
      { name: "description", content: "Today's high impact economic releases from the Forex Factory calendar plus a plain language session read for your watchlist." },
      { property: "og:title", content: "Market news and economic calendar, TradeMind" },
      { property: "og:description", content: "High impact releases and a session read for the instruments you trade." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewsPage,
});

type Impact = "all" | "high" | "medium";

function impactClass(impact: string) {
  const i = impact.toLowerCase();
  if (i.includes("high")) return "border-destructive/60 text-destructive";
  if (i.includes("medium")) return "border-primary/60 text-primary";
  if (i.includes("holiday")) return "border-border text-muted-foreground";
  return "border-border text-muted-foreground";
}

function NewsPage() {
  const { timezone, resolvedTimezone } = useTimezone();
  const [filter, setFilter] = useState<Impact>("high");

  const getState = useServerFn(getBriefingState);
  const stateQ = useQuery({ queryKey: ["briefingState"], queryFn: () => getState() });
  const watchlist: string[] = (stateQ.data?.prefs?.watchlist as string[] | undefined) ?? [];

  const fetchNews = useServerFn(getMarketNews);
  const news = useQuery({
    queryKey: ["marketNews", watchlist.join(",")],
    queryFn: () => fetchNews({ data: { withWriteup: true, watchlist } }),
    enabled: !stateQ.isLoading,
    staleTime: 10 * 60 * 1000,
  });

  const events = useMemo(() => {
    const list = news.data?.events ?? [];
    if (filter === "all") return list;
    if (filter === "high") return list.filter((e) => /high/i.test(e.impact));
    return list.filter((e) => /high|medium/i.test(e.impact));
  }, [news.data, filter]);

  const fmtTime = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: resolvedTimezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    } catch {
      return new Date(iso).toUTCString().slice(0, 22);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">News and economic calendar</h1>
          <p className="text-sm text-muted-foreground">
            Forex Factory releases for this session, shown in {resolvedTimezone ?? "your local time"}. The same feed is attached to your briefings and to the AI coach.
          </p>
        </div>
        <button
          onClick={() => news.refetch()}
          disabled={news.isFetching}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        ><RefreshCw className={`size-4 ${news.isFetching ? "animate-spin" : ""}`} /> Refresh</button>
      </header>

      <section className="rounded-md border border-border bg-card/40 p-4">
        <h2 className="mb-2 font-semibold">Session read</h2>
        {news.isLoading ? (
          <p className="text-sm text-muted-foreground">Reading the calendar...</p>
        ) : news.data?.writeup ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{news.data.writeup}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No session read available right now.</p>
        )}
      </section>

      <section className="rounded-md border border-border bg-card/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Releases</h2>
          <div className="flex items-center gap-1 text-xs">
            {(["high", "medium", "all"] as Impact[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md border px-2 py-1 capitalize ${filter === f ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >{f === "medium" ? "high + medium" : f}</button>
            ))}
          </div>
        </div>

        {news.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading calendar...</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on the calendar for this filter. Quiet tape, trade your levels.</p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((e, i) => (
              <li key={`${e.date}-${e.title}-${i}`} className="flex items-start gap-3 py-2.5">
                <span className="w-32 shrink-0 text-xs text-muted-foreground">{fmtTime(e.date)}</span>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${impactClass(e.impact)}`}>{e.impact}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    <span className="mr-1.5 text-xs text-muted-foreground">{e.country}</span>
                    {e.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.actual ? `Actual ${e.actual} · ` : ""}
                    {e.forecast ? `Forecast ${e.forecast} · ` : ""}
                    {e.previous ? `Previous ${e.previous}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        Delivery settings: <Link to="/briefings" className="underline">Briefings</Link> and <Link to="/telegram" className="underline">Telegram</Link>.
      </p>
    </div>
  );
}
