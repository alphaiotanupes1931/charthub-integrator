import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  Search,
  Activity,
  Target,
  BarChart2,
  TrendingUp,
  Layers,
  GitBranch,
  Waves,
  Anchor,
  Sparkles,
  Sun,
  Flag,
  Repeat,
  LineChart,
} from "lucide-react";

export const Route = createFileRoute("/_app/levels")({
  head: () => ({
    meta: [
      { title: "Levels, TradeMind" },
      { name: "description", content: "Learn what every price level on your chart means, how it forms, and how to trade it." },
    ],
  }),
  component: LevelsPage,
});

type Category = "Volume" | "Structure" | "Session" | "Order Flow" | "Trend";

type LevelDef = {
  key: string;
  name: string;
  short: string;
  category: Category;
  icon: React.ComponentType<{ className?: string }>;
  what: string;
  how: string;
  why: string;
  entry: string;
  invalidation: string;
  examples: string[];
};

const LEVELS: LevelDef[] = [
  {
    key: "vwap",
    name: "VWAP",
    short: "Volume Weighted Average Price",
    category: "Volume",
    icon: Activity,
    what: "The average price of the session weighted by volume. It resets at the start of each session and represents where the 'average' participant is positioned.",
    how: "Sum of (price x volume) at every trade divided by total volume from session open. Institutional desks benchmark their fills against it.",
    why: "Price above VWAP means buyers are in control on average; below means sellers. Reclaiming or losing VWAP often triggers algo flow.",
    entry: "Fade extensions back to VWAP in a range. In trend, buy pullbacks that hold VWAP (or sell rallies that fail it).",
    invalidation: "Clean acceptance (2+ candles closing) on the wrong side of VWAP with volume expansion.",
    examples: ["NAS100 opens strong, pulls back to VWAP at 10:30, holds, and rips into the close.", "Gold loses VWAP after CPI; failed reclaims become shorts."],
  },
  {
    key: "poc",
    name: "POC",
    short: "Point of Control",
    category: "Volume",
    icon: Target,
    what: "The single price level with the most traded volume during a session or range. It's the 'fair value' magnet of the profile.",
    how: "Built from a volume profile (horizontal histogram of volume at each price). The tallest bar is the POC.",
    why: "Price gravitates back to POC when auction is balanced. A POC that shifts up day-over-day signals accumulation.",
    entry: "Mean-reversion back to POC from the value area edges. Breakout continuation once POC is defended.",
    invalidation: "Fast rejection through the POC without pausing - signals one-sided flow, not balance.",
    examples: ["ES sells off to prior day POC and bounces exactly.", "Migrating POC higher three days in a row = trend day setup."],
  },
  {
    key: "value-area",
    name: "Value Area (VAH/VAL)",
    short: "70% of session volume range",
    category: "Volume",
    icon: BarChart2,
    what: "The price range that contains ~70% of a session's traded volume. VAH is the high edge, VAL is the low edge.",
    how: "Calculated from the volume profile, one standard deviation around the POC.",
    why: "Edges are where auction was 'unfair'. They act as decision points - either reject back to POC, or break out and seek new value.",
    entry: "Fade VAH/VAL on first tap in a balanced market. Trade breakouts on the second test in a trending market.",
    invalidation: "Close outside value that holds for the next session confirms an acceptance move.",
    examples: ["Overnight VAH tags at London open, rejects, sells back to POC.", "Break above prior day VAH with volume = look for continuation to next HTF level."],
  },
  {
    key: "support-resistance",
    name: "Support & Resistance",
    short: "Horizontal price memory",
    category: "Structure",
    icon: Layers,
    what: "Horizontal price levels where the market has previously reversed multiple times. Support = floor; Resistance = ceiling.",
    how: "Drawn from swing highs/lows with 2+ touches. Higher timeframes (Daily, Weekly) matter more than lower.",
    why: "Traders anchor orders (stops, targets, limits) to memorable price. That order clustering becomes self-fulfilling.",
    entry: "Buy support with confirmation (rejection wick, higher low). Sell resistance the same way. Break-and-retest is the highest-quality version.",
    invalidation: "A close beyond the level with the next candle continuing in that direction. Not a wick - a close.",
    examples: ["XAU/USD holds the 2650 weekly support three times, then rallies.", "EUR/USD rejects 1.0900 resistance for the fifth time this month."],
  },
  {
    key: "supply-demand",
    name: "Supply & Demand Zones",
    short: "Origin of imbalanced moves",
    category: "Structure",
    icon: GitBranch,
    what: "Zones (not lines) marking where price left an area in one strong impulsive move. Demand = origin of a rally; Supply = origin of a drop.",
    how: "Identified by a tight consolidation (base) followed by a strong move away. The base itself is the zone.",
    why: "Institutions rarely fill an entire order at one price - they leave unfilled limit orders behind. Price returns to fill them.",
    entry: "Limit orders at the proximal edge of the zone with stop beyond the distal edge. Best on first return.",
    invalidation: "Zone is 'used' after first tap. Second tap has much lower success.",
    examples: ["NAS100 demand zone at 20,500 from Monday's opening drive still holds Friday.", "Fresh 4H supply on US30 gets tapped and rejected 220 pts."],
  },
  {
    key: "order-blocks",
    name: "Order Blocks",
    short: "Last opposing candle before an impulse",
    category: "Order Flow",
    icon: Anchor,
    what: "The last down-candle before a strong up-move (bullish OB), or the last up-candle before a strong drop (bearish OB). A refined supply/demand concept.",
    how: "Mark the candle's body (some traders use the whole range). Only valid if the impulse breaks structure.",
    why: "Considered institutional footprint - the candle where smart money loaded before the move.",
    entry: "Limit inside the OB on first return, stop beyond the wick, target the next liquidity pool.",
    invalidation: "OB is mitigated once price closes fully through it. Un-mitigated OBs stay valid.",
    examples: ["4H bullish OB on Gold gets tapped, wicks, and delivers 40R to the next OB.", "Bearish OB on EUR/USD holds London open sweep."],
  },
  {
    key: "fvg",
    name: "Fair Value Gap (FVG)",
    short: "Three-candle imbalance",
    category: "Order Flow",
    icon: Waves,
    what: "A price gap between candle 1's wick and candle 3's wick, where candle 2 delivered an aggressive move. Market moved 'too fast' and left an inefficiency.",
    how: "Bullish FVG: candle 1 high < candle 3 low. Bearish FVG: candle 1 low > candle 3 high. Draw the box between those two levels.",
    why: "Markets seek efficiency. Price often revisits FVGs to 'rebalance' before continuing.",
    entry: "Limit at the FVG midpoint (CE), stop beyond the full gap, target the next high/low.",
    invalidation: "FVG is 'filled' once price fully closes through it. Partial fills still leave the gap active.",
    examples: ["NY open leaves an FVG on NAS; price rebalances the gap 90 mins later then continues higher.", "Weekly FVG on BTC finally fills after two months, then bounces."],
  },
  {
    key: "liquidity",
    name: "Liquidity Pools",
    short: "Stop clusters above/below obvious highs & lows",
    category: "Order Flow",
    icon: TrendingUp,
    what: "Areas where retail stop-loss orders cluster - just above equal highs (buy-side liquidity) or below equal lows (sell-side liquidity).",
    how: "Look for equal highs/lows, obvious swing points, trendline touches. Those are the stops smart money hunts.",
    why: "Large players need counter-liquidity to fill big orders. They push price into stop clusters to trigger them, then reverse.",
    entry: "Wait for the sweep (price pierces the level then closes back inside). Enter on the reclaim; target the opposite liquidity pool.",
    invalidation: "Price accepts beyond the swept level (holds outside on retest). Then it wasn't a sweep - it was a real breakout.",
    examples: ["Asia range highs on Gold get swept at London open, then price dumps 300 pips.", "Equal lows on ES swept during lunch, reverses into the close."],
  },
  {
    key: "opening-range",
    name: "Opening Range (ORB)",
    short: "First 5 / 15 / 30 min of session",
    category: "Session",
    icon: Sun,
    what: "The high and low of the first N minutes after session open. Common windows: 5m, 15m, 30m for US equities/indices.",
    how: "Mark the highest high and lowest low from open to the ORB cutoff. Those two lines are your levels.",
    why: "The opening range absorbs overnight positioning and news. A break of ORB with volume signals directional conviction for the session.",
    entry: "Buy break of ORB high on retest; short break of ORB low. Stop inside the range; target 1x or 2x the range width.",
    invalidation: "Fake-out: break, then close back inside the range within 1-2 candles. Fade the failed break.",
    examples: ["NAS100 ORB-15 break at 9:45 delivers 200 pts by lunch.", "US30 fake-breaks ORB high, closes back inside, reverses 400 pts."],
  },
  {
    key: "prev-day",
    name: "Previous Day High/Low",
    short: "PDH / PDL",
    category: "Session",
    icon: Flag,
    what: "The high and low of the prior trading day. Universal reference levels every desk watches.",
    how: "Mark the highest and lowest print of the previous session (or previous day for 24h markets).",
    why: "These are the most obvious liquidity levels on the chart. Nearly every strategy - breakout, mean-reversion, liquidity sweep - references them.",
    entry: "Fade first touch in balance. Break-and-retest for continuation. Sweep-and-reverse for liquidity plays.",
    invalidation: "Clean acceptance beyond the level = trend day; do not fade further.",
    examples: ["Gold sweeps PDH at NY open then dumps back to PDL by close.", "NAS holds PDL as support all session."],
  },
  {
    key: "session",
    name: "Session Highs & Lows",
    short: "Asia / London / NY ranges",
    category: "Session",
    icon: Repeat,
    what: "The high/low of each major trading session. Asia (7pm-4am ET), London (3am-11am ET), NY (8am-5pm ET).",
    how: "Mark the extremes of each session as it closes. Overlapping sessions create the most volatile setups.",
    why: "Session transitions are where liquidity shifts hands. Asia's range often gets swept at London open; London's range at NY open.",
    entry: "Trade the sweep-and-reverse of the prior session's range at the next session open.",
    invalidation: "Range holds without a sweep - wait for a cleaner setup.",
    examples: ["Asia high on EUR/USD swept at 3am London, price dumps 60 pips.", "London low on Gold swept at NY open, rallies into close."],
  },
  {
    key: "ma",
    name: "Moving Averages",
    short: "9 / 20 / 50 / 200 EMA",
    category: "Trend",
    icon: LineChart,
    what: "Rolling averages of price over N periods. EMAs weight recent prices more; SMAs are equal-weighted.",
    how: "9 EMA = scalp trend. 20 EMA = intraday trend. 50 EMA = swing trend. 200 EMA = macro trend.",
    why: "Widely watched levels - especially the 50 and 200 - become self-fulfilling. Golden cross (50>200) and death cross (50<200) are institutional signals.",
    entry: "Pullback to the trend MA in the direction of the higher-timeframe trend. Reject-and-reclaim on the trend MA.",
    invalidation: "Price closes and holds on the opposite side of the trend MA for 2+ candles.",
    examples: ["SP500 pulls back to 20 EMA on 1H and bounces 5 sessions in a row.", "BTC loses 200 EMA on daily - macro trend flip."],
  },
  {
    key: "fib",
    name: "Fibonacci Retracements",
    short: "38.2 / 50 / 61.8 / 78.6",
    category: "Structure",
    icon: Sparkles,
    what: "Ratio-based retracement levels drawn from a swing low to a swing high (or vice versa). Common levels: 38.2%, 50%, 61.8%, 78.6%.",
    how: "Anchor the tool from the origin of the impulse to its extreme. The 61.8% (golden ratio) is the highest-probability continuation level.",
    why: "Traders position around these levels; the clustering creates real order flow. Best when they overlap with structure (S/R, OB, FVG).",
    entry: "Long the 61.8% retracement of an uptrend impulse with confirmation. Short the equivalent in a downtrend.",
    invalidation: "Retracement past the 78.6% - the move is losing structure; treat as reversal, not pullback.",
    examples: ["NAS100 4H impulse retraces to 61.8, holds, extends to 1.618 extension.", "Gold 1H retraces past 78.6 - trend broken, wait for new structure."],
  },
];

const CATEGORIES: (Category | "All")[] = ["All", "Volume", "Structure", "Order Flow", "Session", "Trend"];

const categoryColor: Record<Category, string> = {
  Volume: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Structure: "bg-bull/15 text-bull border-bull/30",
  "Order Flow": "bg-purple-500/15 text-purple-400 border-purple-500/30",
  Session: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Trend: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

function LevelsPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "All">("All");
  const [open, setOpen] = useState<LevelDef | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return LEVELS.filter((l) => {
      if (cat !== "All" && l.category !== cat) return false;
      if (!needle) return true;
      return (
        l.name.toLowerCase().includes(needle) ||
        l.short.toLowerCase().includes(needle) ||
        l.what.toLowerCase().includes(needle)
      );
    });
  }, [q, cat]);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Levels"
        description="Every horizontal line on your chart, what it means, and how to trade it."
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search levels (VWAP, POC, order block…)"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border/60 bg-background text-sm focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                cat === c
                  ? "bg-primary/15 text-primary border-primary/40"
                  : "bg-background text-muted-foreground border-border/60 hover:border-primary/30 hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((l) => {
          const Icon = l.icon;
          return (
            <button
              key={l.key}
              onClick={() => setOpen(l)}
              className="text-left rounded-xl border border-border/60 bg-card hover:border-primary/40 hover:bg-primary/5 transition p-4 flex flex-col gap-2 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <span className={`text-[10px] tracking-tight px-2 py-0.5 rounded border ${categoryColor[l.category]}`}>
                  {l.category}
                </span>
              </div>
              <div>
                <div className="font-semibold text-foreground group-hover:text-primary transition">{l.name}</div>
                <div className="text-xs text-muted-foreground">{l.short}</div>
              </div>
              <p className="text-xs text-foreground/80 line-clamp-3 mt-1">{l.what}</p>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-sm text-muted-foreground py-12">
            No levels match your search.
          </div>
        )}
      </div>

      {open && <LevelDetail level={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LevelDetail({ level, onClose }: { level: LevelDef; onClose: () => void }) {
  const Icon = level.icon;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-card border border-border/60 rounded-t-2xl sm:rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card/95 backdrop-blur border-b border-border/60 px-5 py-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold">{level.name}</h2>
                <span className={`text-[10px] tracking-tight px-2 py-0.5 rounded border ${categoryColor[level.category]}`}>
                  {level.category}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">{level.short}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          <Section title="What it is">{level.what}</Section>
          <Section title="How it's calculated / drawn">{level.how}</Section>
          <Section title="Why it works">{level.why}</Section>
          <Section title="How to trade it">{level.entry}</Section>
          <Section title="Invalidation">{level.invalidation}</Section>
          <div>
            <div className="text-xs font-semibold tracking-tight text-muted-foreground mb-2">Examples</div>
            <ul className="space-y-1.5">
              {level.examples.map((e, i) => (
                <li key={i} className="flex gap-2 text-foreground/90">
                  <span className="text-primary shrink-0">•</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-tight text-muted-foreground mb-1.5">{title}</div>
      <p className="text-foreground/90 leading-relaxed">{children}</p>
    </div>
  );
}
