import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getBriefingState, sendBriefingNow } from "@/lib/briefings.functions";
import { getMarketNews } from "@/lib/news.functions";
import { Send, ArrowRight, CalendarClock } from "lucide-react";


export const Route = createFileRoute("/_app/briefings")({
  head: () => ({
    meta: [
      { title: "Daily briefings, TradeMind" },
      { name: "description", content: "Morning and evening briefings covering every instrument TradeMind tracks, with the market events driving the session, delivered in app and to the community Discord." },
      { property: "og:title", content: "Daily briefings, TradeMind" },
      { property: "og:description", content: "Morning and evening market briefings across all instruments, with the session's risk events." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BriefingsPage,
});

const DISCORD_INVITE_URL = "https://discord.gg/trademind";

const COVERED = [
  "XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD", "USD/JPY",
  "NAS100", "SPX500", "US30", "WTI Oil", "BTC/USD", "ETH/USD",
];

function BriefingsPage() {
  const qc = useQueryClient();
  const getState = useServerFn(getBriefingState);
  const state = useQuery({ queryKey: ["briefingState"], queryFn: () => getState() });
  const getNews = useServerFn(getMarketNews);
  const news = useQuery({
    queryKey: ["briefingNews"],
    queryFn: () => getNews({ data: { withWriteup: false, watchlist: [] } }),
    staleTime: 10 * 60 * 1000,
  });


  const sendNow = useMutation({
    mutationFn: useServerFn(sendBriefingNow),
    onSuccess: () => { toast.success("Briefing generated"); qc.invalidateQueries({ queryKey: ["briefingState"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (state.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading briefings...</div>;
  const s = state.data;
  if (!s) return null;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Daily briefings</h1>
        <p className="text-sm text-muted-foreground">
          A morning briefing and an evening report covering every instrument TradeMind tracks, plus the events moving the market that session.
        </p>
      </header>

      <section className="rounded-md border border-border bg-card p-4 space-y-3">
        <h2 className="font-semibold">Where they get posted</h2>
        <p className="text-sm text-muted-foreground">
          Briefings and A/A+ signals go out automatically to the community Discord. No webhook setup, no schedule to configure. Join the server and turn on notifications for the channels you care about.
        </p>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Join the Discord <ArrowRight className="size-4" />
        </a>
        <p className="text-xs text-muted-foreground">
          More detail on the server is on the <Link to="/discord" className="underline">Community</Link> page.
        </p>
      </section>

      <section className="rounded-md border border-border bg-card p-4 space-y-2">
        <h2 className="font-semibold">Coverage</h2>
        <div className="flex flex-wrap gap-2">
          {COVERED.map((c) => (
            <span key={c} className="rounded-md border border-border bg-background px-2 py-1 text-xs font-mono">{c}</span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <CalendarClock className="size-3.5" />
          Every briefing includes the high and medium impact releases for the session, pulled from the economic calendar on <Link to="/news" className="underline">News</Link>.
        </p>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="font-semibold mb-1">Events moving the market</h2>
        <p className="text-xs text-muted-foreground mb-3">
          High and medium impact releases from the Forex Factory calendar (Faireconomy feed), the same list every briefing is built on. Times shown in your local zone.
        </p>
        {news.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading the calendar...</p>
        ) : (news.data?.events?.filter((e) => /high|medium/i.test(e.impact)).length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No high or medium impact releases scheduled. Calendar is quiet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {news.data!.events
              .filter((e) => /high|medium/i.test(e.impact))
              .slice(0, 12)
              .map((e) => (
                <li key={`${e.date}-${e.title}`} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${/high/i.test(e.impact) ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    {e.impact.toUpperCase()}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{e.country}</span>
                  <span className="font-medium">{e.title}</span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {e.actual ? `actual ${e.actual} · ` : ""}{e.forecast ? `forecast ${e.forecast} · ` : ""}{e.previous ? `previous ${e.previous}` : ""}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{new Date(e.date).toLocaleString()}</span>
                </li>
              ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Full calendar and the AI read on it are on <Link to="/news" className="underline">News</Link>.
        </p>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="font-semibold mb-1">Latest A / A+ signals</h2>
        <p className="text-xs text-muted-foreground mb-3">
          The same alerts posted to Discord. Only grade A and A+ setups with directional bias make it here.
        </p>
        {(s as any).signals?.length ? (
          <ul className="divide-y divide-border">
            {(s as any).signals.map((g: any) => (
              <li key={g.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="rounded-md border border-primary px-1.5 py-0.5 text-xs font-semibold text-primary">{g.grade}</span>
                <span className="font-semibold">{g.action} {g.symbol}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  entry {g.entry} · stop {g.stop} · tp1 {g.tp1} · R:R {g.rr} · {g.confidence}%
                </span>
                <span className="ml-auto text-xs text-muted-foreground">{new Date(g.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No A or A+ signals recorded yet. The scanner posts them as they set up.</p>
        )}
      </section>


      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">History</h2>
          <button
            onClick={() => sendNow.mutate({ data: { kind: "ad_hoc" } })}
            disabled={sendNow.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            <Send className="size-4" /> {sendNow.isPending ? "Building..." : "Build a briefing now"}
          </button>
        </div>
        {s.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No briefings yet.</p>
        ) : (
          <ul className="space-y-3">
            {s.history.map((b: any) => (
              <li key={b.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="uppercase">{b.kind}</span>
                  <span>{new Date(b.sent_at).toLocaleString()}</span>
                </div>
                <div className="font-medium mt-1">{b.title}</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground mt-2">{b.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
