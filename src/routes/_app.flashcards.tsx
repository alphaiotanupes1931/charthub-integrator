import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ChevronLeft, ChevronRight, Shuffle, RotateCcw, Check, X, Search } from "lucide-react";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

export const Route = createFileRoute("/_app/flashcards")({
  head: () => ({
    meta: [
      { title: "Flashcards, TradeMind" },
      { name: "description", content: "Learn trading and TradeMind in short flip-card lessons — concepts, patterns, risk, psychology and platform features." },
    ],
  }),
  component: FlashcardsPage,
});

type Card = { q: string; a: string };
type Deck = {
  id: string;
  name: string;
  blurb: string;
  cards: Card[];
};

const DECKS: Deck[] = [
  {
    id: "basics",
    name: "Trading Basics",
    blurb: "The vocabulary every trader needs before touching a chart.",
    cards: [
      { q: "What is a pip?", a: "The smallest standard price move in most FX pairs — 0.0001 for pairs like EUR/USD, 0.01 for JPY pairs." },
      { q: "What is leverage?", a: "Borrowed capital that lets you control a larger position than your account balance. 10x leverage means $1,000 controls $10,000." },
      { q: "Bid vs Ask?", a: "Bid is the highest price a buyer will pay. Ask is the lowest price a seller will accept. The gap is the spread." },
      { q: "What is slippage?", a: "The difference between the price you expected and the price you actually filled at. Common in fast markets or thin liquidity." },
      { q: "Long vs Short?", a: "Long = buying, profit when price goes up. Short = selling borrowed, profit when price goes down." },
      { q: "What is a lot?", a: "A standardized trade size. In FX: 1 standard lot = 100,000 units, mini = 10,000, micro = 1,000." },
      { q: "What is drawdown?", a: "The peak-to-trough decline in your account. Measured in % from your highest balance." },
      { q: "What is risk/reward?", a: "The ratio of how much you risk to how much you aim to make. 1:2 means risking $100 to make $200." },
    ],
  },
  {
    id: "levels",
    name: "Levels & Structure",
    blurb: "The lines on your chart and why they matter.",
    cards: [
      { q: "What is support?", a: "A price floor where buyers have historically stepped in. Multiple touches make it stronger." },
      { q: "What is resistance?", a: "A price ceiling where sellers have historically stepped in. Break-and-hold flips it into support." },
      { q: "What is VWAP?", a: "Volume Weighted Average Price. The session's average fill price — institutions benchmark against it." },
      { q: "What is a supply zone?", a: "The origin of a strong drop. Unfilled sell orders sit there — price often reacts on the return." },
      { q: "What is a demand zone?", a: "The origin of a strong rally. Unfilled buy orders sit there — price often bounces on the return." },
      { q: "What is an order block?", a: "The last opposing candle before a strong impulsive move that broke structure. A refined supply/demand concept." },
      { q: "What is a Fair Value Gap (FVG)?", a: "A 3-candle imbalance where price moved too fast and skipped a range. Markets often revisit to rebalance." },
      { q: "What is liquidity?", a: "Clusters of stop orders sitting above obvious highs or below obvious lows. Big players hunt them to fill size." },
    ],
  },
  {
    id: "patterns",
    name: "Chart Patterns",
    blurb: "Recognizable shapes that repeat across every market.",
    cards: [
      { q: "Head and Shoulders?", a: "Reversal pattern: three peaks with the middle highest. Break of the 'neckline' confirms the reversal." },
      { q: "Double top?", a: "Two failed attempts at the same high. Break of the midpoint low confirms a bearish reversal." },
      { q: "Bull flag?", a: "A sharp move up followed by a tight downward-sloping consolidation. Breakout continues the trend." },
      { q: "Ascending triangle?", a: "Flat resistance with a rising trendline of higher lows. Usually breaks up." },
      { q: "Wedge?", a: "Converging trendlines that both slope the same direction. Rising wedge = bearish, falling wedge = bullish." },
      { q: "Engulfing candle?", a: "One candle's body completely swallows the previous body. Strong reversal signal at key levels." },
      { q: "Pin bar / hammer?", a: "A candle with a long wick rejecting a level. Signals absorption and often precedes a reversal." },
      { q: "Cup and handle?", a: "Rounded bottom (cup) followed by a small pullback (handle). Bullish continuation once the handle breaks." },
    ],
  },
  {
    id: "risk",
    name: "Risk Management",
    blurb: "The rules that keep you in the game long enough to win.",
    cards: [
      { q: "1% rule?", a: "Never risk more than 1% of your account on a single trade. Ten losses in a row still leaves you with ~90%." },
      { q: "How to size a position?", a: "Position size = (Account × Risk %) ÷ (Entry − Stop distance × pip value). Never guess — always calculate." },
      { q: "Where should the stop go?", a: "Beyond the level that invalidates your idea — not at a random dollar amount. The market decides, not your wallet." },
      { q: "What is a break-even stop?", a: "Moving your stop to entry after price runs in your favor. Removes risk from the trade." },
      { q: "Why scale out?", a: "Take partials at logical levels (1R, key resistance). Locks profit while letting the runner extend." },
      { q: "Max daily loss?", a: "A hard cap (e.g. 3% of account) after which you stop trading for the day. Prevents revenge trading." },
      { q: "Correlation risk?", a: "Taking multiple trades in the same direction on correlated pairs (EUR/USD + GBP/USD long) is one big trade, not three small ones." },
      { q: "Risk of ruin?", a: "The statistical chance you blow the account. Grows exponentially with position size — small risk keeps it near zero." },
    ],
  },
  {
    id: "psychology",
    name: "Psychology",
    blurb: "The invisible half of trading — and usually the reason accounts blow up.",
    cards: [
      { q: "What is FOMO?", a: "Fear Of Missing Out. Chasing a move after it's already extended. Almost always fills you at the worst price." },
      { q: "Revenge trading?", a: "Immediately re-entering after a loss to 'get it back'. Emotional decisions compound the damage." },
      { q: "Confirmation bias?", a: "Only noticing evidence that supports the trade you already want to take. Actively hunt the counter-argument." },
      { q: "Loss aversion?", a: "The psychological pain of a loss is roughly 2x the pleasure of an equal win. It's why traders hold losers and cut winners." },
      { q: "Why journal every trade?", a: "You can't fix what you don't measure. The journal shows patterns your memory hides." },
      { q: "What is 'process over outcome'?", a: "A perfect trade can lose. A terrible trade can win. Judge yourself on the process, not the P&L of one trade." },
      { q: "BBHG framework?", a: "Break, Breathe, Hold, Go. When emotions spike: Break from the screen, Breathe to reset, Hold off on impulse trades, Go only when calm." },
      { q: "What is tilt?", a: "An emotional state where discipline collapses. Recognize it early — the correct response is to close the platform, not the position." },
    ],
  },
  {
    id: "platform",
    name: "Using TradeMind",
    blurb: "How to get the most out of every feature on this platform.",
    cards: [
      { q: "What does Run Scan do?", a: "Runs the multi-timeframe AI cascade (4H trend → 1H structure → 15m confirmation) and returns a grade, entry, stop and targets." },
      { q: "What do the grades mean?", a: "A+ = all 3 timeframes aligned. A = strong. B = mixed. C = counter-trend. D = no setup. Only A/A+ auto-execute in paper trading." },
      { q: "Buy Stop vs Buy Limit?", a: "Buy Stop = entry ABOVE current price (breakout). Buy Limit = entry BELOW current price (pullback). Signal cards label which one." },
      { q: "What is the Show Me feature?", a: "Type 'show me' before a question in chat and the AI will draw the concept directly on the chart instead of just describing it." },
      { q: "What is Testing Mode?", a: "A $10,000 paper account where the AI auto-trades A/A+ signals. If drawdown hits 10%, the kill switch flattens everything." },
      { q: "How do Briefings work?", a: "Morning and evening market reports delivered inside the app or via Telegram. Configure in Briefings settings." },
      { q: "What does the Trade Journal track?", a: "Entry, exit, P&L, screenshots, strategy tag, and your mental state at the time. Export as CSV/JSON anytime." },
      { q: "What is Scan Lens?", a: "Upload a screenshot of any chart and the AI reads the symbol, timeframe and structure — then grades it like a live scan." },
    ],
  },
];

const PROG_KEY = "trademind.flashcards.v1";
type Progress = Record<string, { known: string[]; review: string[] }>;

function loadProgress(): Progress {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(PROG_KEY) || "{}"); } catch { return {}; }
}
function saveProgress(p: Progress) {
  try { localStorage.setItem(PROG_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

function FlashcardsPage() {
  const [deckId, setDeckId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [progress, setProgress] = useState<Progress>({});

  useEffect(() => { setProgress(loadProgress()); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return DECKS;
    return DECKS.filter((d) =>
      d.name.toLowerCase().includes(n) ||
      d.blurb.toLowerCase().includes(n) ||
      d.cards.some((c) => c.q.toLowerCase().includes(n))
    );
  }, [q]);

  const deck = DECKS.find((d) => d.id === deckId) ?? null;

  if (deck) {
    return (
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => setDeckId(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> All decks
        </button>
        <DeckPlayer
          deck={deck}
          progress={progress[deck.id] ?? { known: [], review: [] }}
          onProgress={(p) => {
            const next = { ...progress, [deck.id]: p };
            setProgress(next);
            saveProgress(next);
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Flashcards"
        description="Bite-sized lessons on trading concepts, chart patterns, risk, psychology and how to use TradeMind. Flip a card, mark what you know, come back to what you don't."
      />

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search decks and cards..."
          className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:border-primary/50"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((d) => {
          const p = progress[d.id];
          const known = p?.known.length ?? 0;
          const pct = Math.round((known / d.cards.length) * 100);
          return (
            <button
              key={d.id}
              onClick={() => setDeckId(d.id)}
              className="text-left rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition p-5 flex flex-col gap-3 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-foreground text-lg group-hover:text-primary transition">{d.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{d.cards.length} cards</div>
                </div>
                <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-primary/30 text-primary bg-primary/10">
                  {pct}%
                </span>
              </div>
              <p className="text-sm text-foreground/80">{d.blurb}</p>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-auto">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-sm text-muted-foreground py-12">
            No decks match your search.
          </div>
        )}
      </div>
    </div>
  );
}

function DeckPlayer({
  deck,
  progress,
  onProgress,
}: {
  deck: Deck;
  progress: { known: string[]; review: string[] };
  onProgress: (p: { known: string[]; review: string[] }) => void;
}) {
  const [order, setOrder] = useState<number[]>(() => deck.cards.map((_, i) => i));
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => { setIdx(0); setFlipped(false); setOrder(deck.cards.map((_, i) => i)); }, [deck.id]);

  const current = deck.cards[order[idx]];
  const cardKey = current?.q ?? "";
  const knownCount = progress.known.length;
  const reviewCount = progress.review.length;

  function next() {
    setFlipped(false);
    setIdx((i) => Math.min(i + 1, order.length - 1));
  }
  function prev() {
    setFlipped(false);
    setIdx((i) => Math.max(i - 1, 0));
  }
  function shuffle() {
    const arr = [...order];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setOrder(arr);
    setIdx(0);
    setFlipped(false);
  }
  function reset() {
    onProgress({ known: [], review: [] });
    setIdx(0);
    setFlipped(false);
  }
  function mark(status: "known" | "review") {
    const known = new Set(progress.known);
    const review = new Set(progress.review);
    if (status === "known") { known.add(cardKey); review.delete(cardKey); }
    else { review.add(cardKey); known.delete(cardKey); }
    const nextProgress = { known: [...known], review: [...review] };
    onProgress(nextProgress);
    if (nextProgress.known.length + nextProgress.review.length >= 5) {
      emitFirstWeekEvent("flashcards-5", nextProgress.known.length + nextProgress.review.length);
    }
    if (idx < order.length - 1) next();
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-semibold">{deck.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{deck.blurb}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <button onClick={shuffle} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:border-primary/40 hover:text-primary transition">
            <Shuffle className="h-3.5 w-3.5" /> Shuffle
          </button>
          <button onClick={reset} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:border-primary/40 hover:text-primary transition">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
        <span>Card {idx + 1} of {order.length}</span>
        <span>
          <span className="text-bull">{knownCount} known</span>
          <span className="mx-2">·</span>
          <span className="text-amber-400">{reviewCount} to review</span>
        </span>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-5">
        <div className="h-full bg-primary transition-all" style={{ width: `${((idx + 1) / order.length) * 100}%` }} />
      </div>

      <div
        onClick={() => setFlipped((f) => !f)}
        className="relative w-full min-h-[320px] sm:min-h-[380px] cursor-pointer select-none"
        style={{ perspective: "1200px" }}
      >
        <div
          className="relative w-full h-full min-h-[320px] sm:min-h-[380px] transition-transform duration-500"
          style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0)" }}
        >
          <FaceCard side="front" label="Question" body={current?.q ?? ""} />
          <FaceCard side="back" label="Answer" body={current?.a ?? ""} />
        </div>
      </div>

      <div className="text-center text-xs text-muted-foreground mt-3">
        Tap the card to {flipped ? "see the question" : "reveal the answer"}
      </div>

      <div className="flex items-center justify-between gap-2 mt-6">
        <button
          onClick={prev}
          disabled={idx === 0}
          className="inline-flex items-center gap-1 px-4 py-2 rounded-md border border-border text-sm disabled:opacity-40 hover:border-primary/40 hover:text-primary transition"
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => mark("review")}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 transition"
          >
            <X className="h-4 w-4" /> Review
          </button>
          <button
            onClick={() => mark("known")}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium border border-bull/40 text-bull hover:bg-bull/10 transition"
          >
            <Check className="h-4 w-4" /> I know it
          </button>
        </div>
        <button
          onClick={next}
          disabled={idx >= order.length - 1}
          className="inline-flex items-center gap-1 px-4 py-2 rounded-md border border-border text-sm disabled:opacity-40 hover:border-primary/40 hover:text-primary transition"
        >
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FaceCard({ side, label, body }: { side: "front" | "back"; label: string; body: string }) {
  const isBack = side === "back";
  return (
    <div
      className={`absolute inset-0 rounded-2xl border ${isBack ? "border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card" : "border-border bg-card"} shadow-lg flex flex-col items-center justify-center p-6 sm:p-10 text-center`}
      style={{
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: isBack ? "rotateY(180deg)" : undefined,
      }}
    >
      <div className={`text-[10px] uppercase tracking-[0.2em] mb-4 ${isBack ? "text-primary" : "text-muted-foreground"}`}>
        {label}
      </div>
      <div className={`text-lg sm:text-2xl leading-relaxed font-medium ${isBack ? "text-foreground" : "text-foreground"}`}>
        {body}
      </div>
    </div>
  );
}
