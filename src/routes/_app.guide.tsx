import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { BookOpen, Search, PlayCircle, ChevronDown, ArrowUp } from "lucide-react";
import { restartTutorial } from "@/components/Tutorial";

export const Route = createFileRoute("/_app/guide")({
  head: () => ({ meta: [{ title: "Documentation, TradeMind" }] }),
  component: GuidePage,
});

type Item = { q: string; a: string };
type Section = { id: string; group: string; title: string; blurb?: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    group: "Getting started",
    title: "Getting started",
    blurb: "First trade in under 5 minutes - what to do, in order.",
    items: [
      { q: "1. Pick an instrument", a: "From the dashboard sidebar, choose what you want to trade. Gold (XAUUSD) is the most popular and the default. Once selected, the live chart and AI chat sync to that symbol." },
      { q: "2. Run a scan", a: "Click 'Scan' on the dashboard. The AI reviews structure, momentum, volume, and order flow on the higher timeframe and returns a graded signal (A+, A, B+, B, B-, C, or NO ENTRY)." },
      { q: "3. Read the grade", a: "A+/A grades are high-conviction setups. B-grades require caution or smaller size. C and NO ENTRY mean wait - protecting capital is the trade." },
      { q: "4. Execute (optional)", a: "If you connect a broker (Pro tier), you can execute directly from the signal card. Otherwise, copy the entry / stop / TP levels into your platform of choice." },
      { q: "5. Log it in the journal", a: "After the trade closes, log it in the Journal tab with your 3 trader inputs (entry matched plan? exit matched plan? P&L). The system auto-calculates execution score, behavior score, win rate, and R/R over time." },
    ],
  },
  {
    id: "signal-grades",
    group: "Core features",
    title: "Signal grades",
    blurb: "What each grade means and how the AI assigns them.",
    items: [
      { q: "A+ - Highest confidence", a: "Phase C confirmed + Phase D BOS + R:R above 3:1. All three phases of the Sweep → BOS → Retest sequence confirmed with volume spike and LTF BOS. The setup you wait all day for." },
      { q: "A - Strong setup", a: "Phase D BOS + Retest confirmed + R:R above 2:1. Full Wyckoff sequence complete. High-probability entry with structurally valid stop loss." },
      { q: "B+ - Good setup", a: "Phase C forming, awaiting reversal + R:R above 2:1. Sweep + BOS confirmed, retest pullback starting. Trade with proper risk management." },
      { q: "B - Caution", a: "Partial phase confirmation + R:R above 2:1. Some sequence elements confirmed but not all three. Reduce size or wait for more confirmation." },
      { q: "C - No trade", a: "R:R below 2:1 regardless of phase - flagged as invalid. The risk/reward does not justify the entry. Wait for better structure." },
      { q: "NO ENTRY - Consolidation", a: "Sniper Filter active - price is in consolidation or no structural extreme detected. Wait for a Spring, Upthrust, or BOS to form." },
    ],
  },
  {
    id: "instruments",
    group: "Core features",
    title: "Instruments",
    blurb: "Tier access and behavior of each tradeable symbol.",
    items: [
      { q: "Gold (XAUUSD)", a: "Most popular. High volatility, strong trends. Best for 1H and 4H timeframes. Available on all paid tiers." },
      { q: "Silver (XAGUSD)", a: "Correlated with Gold but more volatile. Great for breakout traders. Pro+." },
      { q: "Bitcoin (BTCUSD)", a: "24/7 market. High volatility, strong momentum moves. Pro+." },
      { q: "Nasdaq (NAS100)", a: "US tech index. Active during NY session (9:30am-4pm ET). News-driven. Pro+." },
      { q: "Dow Jones (US30)", a: "US blue-chip index. Steady trends, lower volatility than NAS100. Pro+." },
    ],
  },
  {
    id: "chart-tools",
    group: "Core features",
    title: "Chart tools",
    blurb: "What the overlay toggles and indicators do.",
    items: [
      { q: "VWAP", a: "Volume Weighted Average Price - shows where the majority of volume traded. Price above VWAP = bullish, below = bearish." },
      { q: "POC", a: "Point of Control - the price level with the most trading volume. Acts as a magnet for price." },
      { q: "Support / Resistance", a: "Key price levels where buying or selling pressure is concentrated." },
      { q: "Supply / Demand zones", a: "Areas where institutional orders are likely resting." },
      { q: "TP", a: "Take Profit projections based on technical analysis." },
      { q: "Liquidity zones", a: "Areas where stop losses are clustered. Price often sweeps these before reversing." },
    ],
  },
  {
    id: "trade-management",
    group: "Core features",
    title: "Trade management",
    blurb: "How TradeMind handles trades you're already in (vs. new entries).",
    items: [
      { q: "How it activates", a: "The AI auto-detects when you're already in a position by matching against your open trades in the journal. You can also explicitly say 'manage my XAUUSD long' to force trade-management mode." },
      { q: "The TRADE ACTIVE card", a: "Replaces the usual signal card. Shows current price vs. entry, distance to stop and TP, suggested action (move stop to BE, scale out at TP1, hold full, exit), and reasoning." },
      { q: "Direction conflicts", a: "If a fresh signal contradicts your open position (e.g. you're long but the new scan says SHORT), the AI surfaces a CONFLICT card with three options: close the long first, hedge with a short, or ignore the new signal." },
    ],
  },
  {
    id: "price-alerts",
    group: "Core features",
    title: "Price alerts (deeper)",
    blurb: "Server-monitored alerts with email + in-app notifications.",
    items: [
      { q: "Right-click to set", a: "On the setup chart (after a scan), right-click any price level. A small popover appears with Above / Below buttons. Picking either creates an alert at that exact price." },
      { q: "Why server-side", a: "Alerts are checked every 30 seconds on the server, even when your browser is closed. Triggers send an email AND create an in-app notification - both reach you regardless of which device you're on." },
      { q: "Direction logic", a: "Above: triggers when live price >= target. Below: triggers when live price <= target. Other directions fall back to a ±0.1% proximity check." },
      { q: "Manage alerts", a: "Active alerts show in the dashboard banner. Triggered alerts auto-dismiss. Delete one before trigger via the X on the banner." },
    ],
  },
  {
    id: "journal",
    group: "Core features",
    title: "Journal & scoring",
    blurb: "How the trader-input scoring system grades your execution and behavior.",
    items: [
      { q: "The 3 trader inputs", a: "After a trade closes, log it with: (1) Did entry match your plan? Yes/No. (2) Did exit match your plan? Yes/No. (3) Result and P&L (win/loss + dollar amount)." },
      { q: "Execution score", a: "0-100%. Equals 100% on trades where BOTH entry and exit matched your plan; 0% otherwise. The pure measure of plan adherence." },
      { q: "Behavior score", a: "0-100%. Counts each adherence input separately - gives partial credit. Rewards 'half-right' executions while still distinguishing them from clean ones." },
      { q: "Baseline & all-time progress", a: "Your baseline is your first 10 closed trades. The Journal tab shows baseline → current for execution / behavior / win rate / avg R/R, so you can see whether you're actually improving." },
      { q: "Weekly trends", a: "This week vs. last week comparison with up/down arrows. If your behavior score dropped, you'll see it before the P&L follows." },
    ],
  },
  {
    id: "coaches",
    group: "AI & voice",
    title: "AI coaches",
    blurb: "Five distinct coaching personalities. Pick whoever matches the way you want to be coached.",
    items: [
      { q: "The Analyst", a: "Data-driven, methodical. Focuses on technicals, probability, and risk-reward ratios. Voice: British accent, measured pace." },
      { q: "The Disciplinarian", a: "Strict rule follower. Calls out deviations from your strategy. No excuses. Voice: commanding US, faster pace." },
      { q: "The Mentor", a: "Patient teacher. Explains concepts, asks guiding questions, builds understanding. Voice: warm, neutral." },
      { q: "The Minimalist", a: "Less is more. Short, sharp responses. Just the signal, levels, and grade. Voice: direct, no fluff." },
      { q: "The Psychologist", a: "Focuses on trading psychology, emotional control, behavioral patterns. Voice: empathetic, calm." },
    ],
  },
  {
    id: "show-me",
    group: "AI & voice",
    title: "'Show me' on the chart",
    blurb: "Ask the AI to draw its answer directly on the chart you're viewing.",
    items: [
      { q: "How to use it", a: "In the chat, start your question with 'show me'. Examples: 'show me the FVG', 'show me where to enter', 'show me the liquidity above', 'show me support and resistance'. The AI marks the levels and zones on your live chart." },
      { q: "What it can draw", a: "Support and resistance, fair value gaps (FVG), order blocks, liquidity pools, swing highs and lows, proposed entry / stop / take-profit areas, and trendlines." },
      { q: "Clearing the drawings", a: "Switch symbols, run a new scan, or ask a follow-up that doesn't need drawings and the chart resets. You can also toggle overlays off from the chart controls." },
      { q: "Tips", a: "Be specific about the timeframe or level you want. 'Show me the 1H FVG below price' works better than 'show me stuff'." },
    ],
  },
  {
    id: "voice",
    group: "AI & voice",
    title: "Voice",
    blurb: "Talk to the AI and have it talk back in your selected coach's voice.",
    items: [
      { q: "Audio output (TTS)", a: "All AI responses can be spoken aloud using your browser's text-to-speech. Each of the 5 coaches has a distinct voice profile (gender, accent, pitch, speed)." },
      { q: "Audio input (mic)", a: "Tap the mic on the Voice Coach page to dictate to the AI. Requires Chrome, Edge, or Safari. Firefox does not support browser speech recognition." },
      { q: "Settings", a: "Speed and volume sliders apply to all spoken responses. Per-coach voice can be tested via the Preview button." },
    ],
  },
  {
    id: "plans",
    group: "Account & settings",
    title: "Plans & billing",
    blurb: "Subscription tiers, free trial, payment, cancellation, and reactivation.",
    items: [
      { q: "Where to manage", a: "Settings → Billing to view your current plan, upgrade, downgrade, cancel, or reactivate. Changes take effect at the end of the current billing cycle unless otherwise noted." },
    ],
  },
  {
    id: "appearance",
    group: "Account & settings",
    title: "Appearance & accessibility",
    blurb: "Theme, accessibility, mobile, and keyboard shortcuts.",
    items: [
      { q: "Dark / light theme", a: "Theme follows your device system preference and is saved to your account, syncing across devices." },
      { q: "Mobile + PWA", a: "Fully responsive on phones. iOS: open in Safari, share menu, 'Add to Home Screen'. Android: Chrome shows an Install banner - tap it for a native-app feel." },
      { q: "Keyboard shortcuts", a: "Onboarding tour: ←/→ navigate, Enter advance, Esc skip. Forms: Enter submits when valid. Chat: Enter sends, Shift+Enter newline." },
      { q: "Keyboard focus", a: "Every interactive element has a 2px gold focus outline for keyboard navigation. Tab and Shift+Tab cycle through controls." },
    ],
  },
  {
    id: "security",
    group: "Account & settings",
    title: "Security & account safety",
    blurb: "What we do to keep your account safe + what you can enable.",
    items: [
      { q: "Two-factor authentication", a: "Optional TOTP 2FA. Use Google Authenticator, Authy, or 1Password. Mandatory for admin accounts. Setup via /api/auth/2fa endpoints (Settings UI coming)." },
      { q: "Account lockout", a: "After 5 failed login attempts on a single email, the account locks for 15 minutes. Wait it out or reset your password to clear it." },
      { q: "New-IP login email", a: "Sign in from an IP you've never used before? You'll get an email confirming it was you. If it wasn't, change your password immediately." },
      { q: "Password requirements", a: "Min 8 characters, must include upper + lower + number + special. Common/guessable passwords (e.g. Password1!, qwerty123) are rejected." },
      { q: "Session lifetime", a: "Sessions last 30 days of inactivity. Changing your password force-logs-out all other devices immediately." },
    ],
  },
  {
    id: "your-data",
    group: "Account & settings",
    title: "Your data",
    blurb: "What we store, what you can export, what you can delete.",
    items: [
      { q: "Export your trades", a: "Journal → Trades tab → Export CSV. Downloads every closed trade with date, instrument, direction, P&L, R:R, notes, and timestamps." },
      { q: "Delete your account", a: "Email support@trademindaicoach.com from your account address. We'll process within 30 days, deleting all your trades, journal entries, conversation history, and personal info. Anonymized analytics may be retained." },
      { q: "Encryption", a: "Broker credentials encrypted at rest with AES-256-CBC. Passwords hashed with bcrypt. Everything in transit over TLS." },
    ],
  },
  {
    id: "faq",
    group: "Support",
    title: "FAQ",
    blurb: "Common questions.",
    items: [
      { q: "Why did I get a B signal?", a: "A B grade means partial Wyckoff phase confirmation with R:R above 2:1, but not all three sequence phases are confirmed. Wait for more confirmation or trade with reduced size." },
      { q: "What does NO ENTRY mean?", a: "NO ENTRY means the Sniper Entry Filter detected consolidation - no directional bias is forced. Protecting capital IS the trade." },
      { q: "How often should I scan?", a: "Before every potential entry. The market changes fast - a B+ from an hour ago may be A+ or C now. Always re-scan before committing capital." },
      { q: "Can I use TradeMind on my phone?", a: "Yes. TradeMind is fully responsive and installable as a PWA from your phone's browser." },
      { q: "How do I switch AI coaches?", a: "AI Coaches in the sidebar - pick the coaching personality that matches how you want to be coached." },
      { q: "What timeframes does the chart support?", a: "1m, 5m, 15m, 1H, 4H, and 1D. The AI scan defaults to 1H but references multiple timeframes." },
    ],
  },
];

function GuidePage() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const [activeGroup, setActiveGroup] = useState<string>(SECTIONS[0].group);
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const [showTop, setShowTop] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS
      .map((s) => ({ ...s, items: s.items.filter((i) => i.q.toLowerCase().includes(q) || i.a.toLowerCase().includes(q)) }))
      .filter((s) => s.items.length > 0 || s.title.toLowerCase().includes(q));
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map<string, Section[]>();
    for (const s of filtered) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group)!.push(s);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const allGroups = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of SECTIONS) if (!seen.has(s.group)) { seen.add(s.group); out.push(s.group); }
    return out;
  }, []);

  const visibleGroups = query.trim()
    ? groups
    : groups.filter(([g]) => g === activeGroup);

  // When searching, auto-expand matching items so answers are visible.
  useEffect(() => {
    if (!query.trim()) return;
    const next: Record<string, boolean> = {};
    for (const s of filtered) for (const i of s.items) next[`${s.id}::${i.q}`] = true;
    setOpenItems(next);
  }, [query, filtered]);

  useEffect(() => {
    const onScroll = () => {
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top < 120) current = s.id;
      }
      setActive(current);
      setShowTop(window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toggleItem = (key: string) =>
    setOpenItems((p) => ({ ...p, [key]: !p[key] }));

  const expandAll = (section: Section) => {
    const next = { ...openItems };
    const allOpen = section.items.every((i) => next[`${section.id}::${i.q}`]);
    for (const i of section.items) next[`${section.id}::${i.q}`] = !allOpen;
    setOpenItems(next);
  };

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="p-4 md:p-8 max-w-[1200px] mx-auto">
      <PageHeader
        title="Documentation"
        icon={<BookOpen className="h-8 w-8 text-primary" />}
        description="Everything you need to get the most out of TradeMind."
        action={
          <button
            onClick={restartTutorial}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            <PlayCircle className="h-4 w-4" /> Replay tour
          </button>
        }
      />

      {/* Search - sticky so it's always reachable */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-background/85 backdrop-blur border-b border-border/60 mb-4">
        <div className="relative max-w-[1136px] mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the docs…"
            className="w-full rounded-lg border border-border bg-card/70 pl-9 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* Group tabs - visible on all breakpoints; drives desktop content filter too */}
      {!query.trim() && (
        <div className="flex flex-wrap gap-1.5 mb-6 pb-1">
          {allGroups.map((g) => (
            <button
              key={g}
              onClick={() => { setActiveGroup(g); scrollToTop(); }}
              className={`text-xs font-medium rounded-full px-3 py-1.5 border transition ${
                activeGroup === g
                  ? "bg-primary/15 border-primary/50 text-primary"
                  : "bg-card/40 border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
        {/* Sidebar TOC */}
        <aside className="hidden md:block sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
          {(query.trim() ? groups : groups.filter(([g]) => g === activeGroup)).map(([group, sections]) => (
            <div key={group} className="mb-5">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">{group}</div>
              <ul className="space-y-1">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`flex items-center justify-between gap-2 text-sm rounded-md px-2 py-1 transition-colors ${
                        active === s.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      }`}
                    >
                      <span className="truncate">{s.title}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{s.items.length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button
            onClick={scrollToTop}
            className="mt-2 w-full text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground py-2 border-t border-border/60"
            aria-label="Back to top"
          >
            ↑
          </button>
        </aside>

        {/* Main content */}
        <main className="min-w-0">
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
              No results for "{query}".
            </div>
          )}

          {visibleGroups.flatMap(([, sections]) => sections).map((section) => {
            const allOpen = section.items.every((i) => openItems[`${section.id}::${i.q}`]);
            return (
              <section key={section.id} id={section.id} className="mb-10 scroll-mt-24">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h2 className="text-xl md:text-2xl font-semibold">{section.title}</h2>
                  <button
                    onClick={() => expandAll(section)}
                    className="shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded-md px-2 py-1"
                  >
                    {allOpen ? "Collapse all" : "Expand all"}
                  </button>
                </div>
                {section.blurb && <p className="text-sm text-muted-foreground mb-4">{section.blurb}</p>}
                <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  {section.items.map((item) => {
                    const key = `${section.id}::${item.q}`;
                    const open = !!openItems[key];
                    return (
                      <div key={item.q}>
                        <button
                          onClick={() => toggleItem(key)}
                          className="w-full flex items-center justify-between gap-3 text-left px-4 py-3.5 hover:bg-muted/30 transition"
                          aria-expanded={open}
                        >
                          <span className="font-medium text-sm">{item.q}</span>
                          <ChevronDown
                            className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                          />
                        </button>
                        {open && (
                          <div className="px-4 pb-4 -mt-1">
                            <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <div className="border-t border-border pt-6 mt-8 flex items-center justify-between gap-4 flex-wrap text-sm text-muted-foreground">
            <div>
              Need help? Email{" "}
              <a href="mailto:support@trademindaicoach.com" className="text-primary hover:underline">
                support@trademindaicoach.com
              </a>
              .
            </div>
            <button
              onClick={scrollToTop}
              aria-label="Back to top"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/50 hover:text-foreground"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </main>
      </div>

      {/* Floating back-to-top */}
      {showTop && (
        <button
          onClick={scrollToTop}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary shadow-lg backdrop-blur hover:bg-primary/25 transition"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
