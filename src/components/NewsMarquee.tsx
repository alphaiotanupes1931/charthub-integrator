import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Newspaper } from "lucide-react";
import { getMarketNews, type NewsPayload } from "@/lib/news.functions";

type Item = NewsPayload["events"][number];

function impactTone(impact: string) {
  const i = impact.toLowerCase();
  if (i.includes("high")) return "bg-destructive";
  if (i.includes("medium")) return "bg-primary";
  return "bg-muted-foreground";
}

function clock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Desktop header news ticker. Scrolls the economic calendar headlines and
 * links through to the full news page. Hidden on small screens.
 */
export function NewsMarquee() {
  const fetchNews = useServerFn(getMarketNews);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetchNews({ data: { withWriteup: false, watchlist: [] } });
        if (alive) setItems(res.events.slice(0, 14));
      } catch { /* header ticker stays hidden on failure */ }
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [fetchNews]);

  if (items.length === 0) return null;
  const row = [...items, ...items];
  // Longer lists need proportionally longer cycles to keep a steady speed.
  const duration = Math.max(40, items.length * 6);

  return (
    <Link
      to="/news"
      aria-label="Open the news page"
      className="group hidden md:flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-md border border-border px-3 py-1.5"
    >
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Newspaper className="h-3.5 w-3.5" />
        News
      </span>
      <span className="relative min-w-0 flex-1 overflow-hidden">
        <span className="news-marquee flex w-max gap-6 whitespace-nowrap">
          {row.map((e, i) => (
            <span key={`${e.date}-${e.title}-${i}`} className="flex items-center gap-2 text-xs">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${impactTone(e.impact)}`} />
              <span className="font-mono text-[11px] text-muted-foreground">{clock(e.date)}</span>
              <span className="text-muted-foreground">{e.country}</span>
              <span className="text-foreground">{e.title}</span>
              {e.actual ? (
                <span className="font-mono text-[11px] text-muted-foreground">act {e.actual}</span>
              ) : e.forecast ? (
                <span className="font-mono text-[11px] text-muted-foreground">fc {e.forecast}</span>
              ) : null}
            </span>
          ))}
        </span>
      </span>
      <style>{`
        @keyframes news-marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .news-marquee { animation: news-marquee-scroll ${duration}s linear infinite; }
        .group:hover .news-marquee { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .news-marquee { animation: none; } }
      `}</style>
    </Link>
  );
}
