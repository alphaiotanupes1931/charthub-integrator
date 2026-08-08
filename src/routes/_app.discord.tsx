import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import {
  MessageSquare,
  Users,
  BellRing,
  LineChart,
  GraduationCap,
  Sparkles,
  ShieldCheck,
  ExternalLink,
  ArrowRight,
} from "lucide-react";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

export const Route = createFileRoute("/_app/discord")({
  head: () => ({
    meta: [
      { title: "Community, TradeMind" },
      { name: "description", content: "Join the TradeMind Community on Discord for live A/A+ signals, daily briefings, and traders learning together." },
    ],
  }),
  component: DiscordPage,
});

// Update this if the invite ever changes.
const DISCORD_INVITE_URL = "https://discord.gg/QxFmjccTH";

const FEATURES: Array<{ icon: React.ReactNode; title: string; desc: string }> = [
  {
    icon: <BellRing className="h-5 w-5" />,
    title: "Live A / A+ signal alerts",
    desc: "The moment TradeMind flags a high-conviction setup on any watchlist symbol, it drops in the signals channel with the grade, entry, stop, and target.",
  },
  {
    icon: <LineChart className="h-5 w-5" />,
    title: "Morning + evening briefings",
    desc: "Two daily posts covering the sessions ahead, what set up overnight, and what to watch next. Written for humans, not filled with jargon.",
  },
  {
    icon: <Users className="h-5 w-5" />,
    title: "Trade with other members",
    desc: "Share your setups, get a second opinion before you click, and see what other members are watching in real time.",
  },
  {
    icon: <GraduationCap className="h-5 w-5" />,
    title: "Weekly learning drops",
    desc: "New Academy lessons, chart breakdowns, and mistake-of-the-week posts. Great if you learn better by watching and discussing.",
  },
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: "Feature requests + early access",
    desc: "Vote on what we build next. Community members get early access to new tools before they go wide.",
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Safe, moderated, no shilling",
    desc: "No pump groups, no paid signal spam, no crypto scams. Just traders working on their process.",
  },
];

function DiscordPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <PageHeader
        title="TradeMind Community"
        description="Join the private Discord where members get live A/A+ signals, daily briefings, and learn alongside other traders."
        icon={<MessageSquare className="h-6 w-6 text-primary" />}
      />

      {/* Hero / Join card */}
      <section className="rounded-md border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3">
              <Users className="h-3 w-3" /> Members-only
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-semibold mb-2">
              Join the TradeMind Community on Discord
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl leading-relaxed">
              Free for TradeMind users. One click to join, no forms or webhook setup.
              You&apos;ll land in a private server with live signals, daily briefings, and other members
              working through the same setups you are.
            </p>
          </div>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => emitFirstWeekEvent("discord-joined")}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground border border-primary shrink-0 w-full sm:w-auto"
          >
            Join the Discord
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="font-display text-lg sm:text-xl font-semibold mb-1">What&apos;s inside</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Everything below runs in the community server. No setup on your end.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-md border border-border bg-background text-primary flex items-center justify-center">
                  {f.icon}
                </div>
                <div className="font-semibold text-sm">{f.title}</div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How to join */}
      <section className="rounded-md border border-border bg-card p-5 sm:p-6">
        <h2 className="font-semibold mb-3">How to join, step by step</h2>
        <ol className="space-y-2.5 text-sm">
          <li className="flex gap-3">
            <span className="shrink-0 h-6 w-6 rounded-md border border-border bg-background text-xs font-semibold flex items-center justify-center">1</span>
            <span>
              Click <span className="font-medium">Join the Discord</span> above. It opens Discord in a new tab.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 h-6 w-6 rounded-md border border-border bg-background text-xs font-semibold flex items-center justify-center">2</span>
            <span>
              If you don&apos;t have Discord, create a free account. It takes about a minute.
              You can use Discord in your web browser, no download needed.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 h-6 w-6 rounded-md border border-border bg-background text-xs font-semibold flex items-center justify-center">3</span>
            <span>
              Accept the invite, read the pinned welcome post, and head to
              <span className="font-mono text-xs mx-1 rounded border border-border px-1 py-0.5">#signals</span>
              to see today&apos;s posts.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 h-6 w-6 rounded-md border border-border bg-background text-xs font-semibold flex items-center justify-center">4</span>
            <span>
              Turn on notifications for the channels you care about, so you don&apos;t miss the next A/A+ signal.
            </span>
          </li>
        </ol>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => emitFirstWeekEvent("discord-joined")}
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
        >
          Open the invite <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </section>

      <p className="text-[11px] text-muted-foreground text-center">
        Educational community. Signals and briefings are not financial advice.
      </p>
    </div>
  );
}
