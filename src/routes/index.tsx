import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowRight, Check, HelpCircle } from "lucide-react";
import { TickerTape } from "@/components/TickerTape";
import { MiniChart, SymbolOverview } from "@/components/MiniChart";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
// 3D candlestick scene removed for a more legitimate platform aesthetic
import logoAsset from "@/assets/logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TradeMind, Trade smarter. Every single setup." },
      {
        name: "description",
        content:
          "TradeMind is the first AI trading coach that grades every setup before you risk a dollar, so you only take the trades that deserve to win.",
      },
      { property: "og:title", content: "TradeMind, AI Trading Coach" },
      {
        property: "og:description",
        content: "Grade every setup A+ to NO ENTRY. Built for serious day traders, prop traders, and swing traders.",
      },
    ],
  }),
  component: Landing,
});

const TICKER = [
  { proName: "OANDA:XAUUSD", title: "XAU/USD" },
  { proName: "BINANCE:BTCUSDT", title: "BTC/USD" },
  { proName: "FOREXCOM:NSXUSD", title: "NAS100" },
  { proName: "FOREXCOM:SPXUSD", title: "SPX" },
  { proName: "FOREXCOM:DJI", title: "US30" },
  { proName: "FX:EURUSD", title: "EUR/USD" },
];

const COACHES = [
  { name: "The Analyst", tag: "Wyckoff & structure first.", quote: "Show me the phase before you click buy." },
  { name: "The Sniper", tag: "A+ setups only. Or nothing.", quote: "Patience is profit. Wait." },
  { name: "The Mentor", tag: "The lesson is the trade.", quote: "What did you learn from the last loss?" },
  { name: "The Beast", tag: "Press conviction. Hard.", quote: "You see it. Take it. NOW." },
  { name: "The Monk", tag: "The market will be there.", quote: "Tomorrow is a new chart." },
];

const PRICING = [
  {
    name: "Basic",
    price: 49,
    features: ["1 instrument", "Generic AI coach", "Trade journal", "Web access"],
    popular: false,
  },
  {
    name: "Pro",
    price: 97,
    features: ["5 instruments", "All 5 AI coaches", "Pattern detection", "Voice coach", "Broker integration", "Mobile app"],
    popular: true,
  },
  {
    name: "Elite",
    price: 197,
    features: ["Unlimited instruments", "Custom strategies", "Priority scans", "1:1 onboarding", "Direct support"],
    popular: false,
  },
];

const FAQS = [
  {
    q: "What is TradeMind?",
    a: "An AI trading coach that grades every setup before you risk capital, so you only take the trades that deserve to win.",
  },
  {
    q: "Is TradeMind a broker?",
    a: "No. We do not hold funds or execute trades. You can connect supported brokers to import history, but execution stays with your broker.",
  },
  {
    q: "Can I change my AI coach?",
    a: "Yes. Pick from five personalities in the Coaches tab and switch anytime from the dashboard.",
  },
  {
    q: "Is my trade data secure?",
    a: "Yes. Encrypted connections, row-level security, and no sharing of raw trade history with third parties.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen w-full text-foreground">
      <Nav />

      {/* HERO */}
      <section className="relative px-5 sm:px-6 pt-12 sm:pt-20 pb-10 sm:pb-12">
        <div className="absolute inset-0 grid-bg opacity-50 pointer-events-none" />
        <div className="relative max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-gold" />
            Now in public beta
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.05 }}
            className="font-display mt-8 sm:mt-10 text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-medium leading-[1.05] tracking-tight"
          >
            Trade smarter.
            <br />
            <span className="text-primary">Every single setup.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mt-6 sm:mt-8 text-sm sm:text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            TradeMind is the first AI trading coach that grades every setup before you risk a dollar , 
            so you only take the trades that deserve to win.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-8 sm:mt-10 flex flex-col items-center gap-5"
          >
            <Link
              to="/dashboard"
              className="group inline-flex items-center gap-2 rounded-full bg-foreground text-background px-7 py-3.5 text-sm font-semibold hover:scale-[1.02] transition shadow-2xl"
            >
              Start free
              <ArrowRight className="size-4 group-hover:translate-x-0.5 transition" />
            </Link>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <Bullet>7-day free trial</Bullet>
              <Bullet>Cancel anytime</Bullet>
              <Bullet>SOC2 compliant</Bullet>
            </div>
          </motion.div>
        </div>
      </section>


      {/* LIVE CHART PREVIEW */}
      <section className="relative px-4 sm:px-6 pb-12 sm:pb-16">
        <div className="max-w-6xl mx-auto">
          <BrowserFrame url="trademindaicoach.com/dashboard">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 sm:gap-6 p-4 sm:p-6">
              <div>
                <div className="text-sm text-muted-foreground mb-1">XAU/USD · Gold Spot</div>
                <SymbolOverview symbol="OANDA:XAUUSD" height={320} />
              </div>
              <aside className="space-y-4 sm:space-y-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-gold" />
                  New signal
                </div>
                <div className="font-display text-6xl sm:text-7xl text-primary leading-none">A+</div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Spring at recent low confirmed. Wait for retest before risking.
                </p>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
                    Watchlist
                  </div>
                  <div className="space-y-2">
                    <WatchRow symbol="BINANCE:BTCUSDT" label="BTC/USD" />
                    <WatchRow symbol="FOREXCOM:NSXUSD" label="NAS100" />
                    <WatchRow symbol="FOREXCOM:SPXUSD" label="SPX" />
                  </div>
                </div>
              </aside>
            </div>
          </BrowserFrame>
        </div>
      </section>


      {/* TICKER */}
      <div className="border-y border-border/60 bg-card/30 backdrop-blur">
        <TickerTape symbols={TICKER} />
      </div>

      {/* HOW IT WORKS */}
      <section id="product" className="px-5 sm:px-6 py-16 sm:py-24 md:py-28 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <SectionEyebrow>How it works</SectionEyebrow>
          <h2 className="font-display text-3xl sm:text-4xl md:text-6xl font-medium text-center leading-tight">
            Three steps. Zero guesswork.
          </h2>
          <p className="text-center text-sm sm:text-base text-muted-foreground mt-4 max-w-xl mx-auto px-2">
            From chart to confident execution in under thirty seconds.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 mt-10 sm:mt-16">
            {[
              {
                step: "Step 01",
                title: "Pick your setup",
                body: "Connect a chart or paste a screenshot. TradeMind reads structure, sweeps, BOS, retests, automatically.",
              },
              {
                step: "Step 02",
                title: "Get the grade",
                body: "Every setup gets a letter grade A+ to NO ENTRY based on confluence, R:R, and your strategy.",
              },
              {
                step: "Step 03",
                title: "Take only A and above",
                body: "Your AI coach narrates the play, flags the trap, and journals the trade for you when it closes.",
              },
            ].map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="rounded-2xl border border-border bg-card/40 p-6 sm:p-8 hover-lift"
              >
                <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">{s.step}</div>
                <h3 className="font-display text-xl sm:text-2xl md:text-3xl mt-4 sm:mt-5">{s.title}</h3>
                <p className="text-sm text-muted-foreground mt-3 sm:mt-4 leading-relaxed">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>


      {/* GRADING SECTION */}
      <section className="px-5 sm:px-6 py-16 sm:py-24 md:py-28 border-t border-border/60">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 sm:gap-12 lg:gap-16 items-center">
          <div>
            <SectionEyebrow align="left">Signal grading</SectionEyebrow>
            <h2 className="font-display text-3xl sm:text-4xl md:text-6xl font-medium leading-[1.05] tracking-tight">
              Grade every setup before you fire.
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-5 sm:mt-6 leading-relaxed max-w-md">
              Each TradeMind signal is graded on six dimensions, structure, momentum, risk, confluence,
              session, and your personal track record. Only A and A+ deserve real risk.
            </p>
            <div className="grid grid-cols-4 gap-2 sm:gap-3 mt-8 sm:mt-10 max-w-md">
              <GradeChip grade="A+" color="text-primary" border="border-primary/50" label="Take it" />
              <GradeChip grade="A" color="text-emerald-400" border="border-emerald-500/40" label="Strong" />
              <GradeChip grade="B" color="text-foreground/80" border="border-border" label="Optional" />
              <GradeChip grade="C" color="text-destructive" border="border-destructive/40" label="Skip" />
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="rounded-2xl glass-strong p-6 sm:p-8 space-y-5 sm:space-y-6"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-semibold uppercase tracking-[0.16em] text-primary text-[10px] sm:text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-gold" />
                Long · XAU/USD
              </div>
              <span className="font-mono text-muted-foreground shrink-0">13:42:08</span>
            </div>
            <div className="font-display text-6xl sm:text-7xl md:text-8xl text-primary leading-none">A+</div>
            <p className="text-sm leading-relaxed">
              "Spring at recent low confirmed. Phase D BOS on the 5m. Wait for the retest, your stop is structurally clean."
            </p>
            <div className="border-t border-border/60 pt-4 sm:pt-5">
              <MiniChart symbol="OANDA:XAUUSD" height={120} dateRange="1D" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">Confidence</span>
                <span className="text-primary font-semibold">84%</span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full w-[84%] bg-gold-gradient" />
              </div>
            </div>
          </motion.div>
        </div>
      </section>


      {/* COACHES */}
      <section id="coaches" className="px-5 sm:px-6 py-16 sm:py-24 md:py-28 border-t border-border/60 scroll-mt-24">

        <div className="max-w-6xl mx-auto">
          <SectionEyebrow>Five personalities</SectionEyebrow>
          <h2 className="font-display text-3xl sm:text-4xl md:text-6xl font-medium text-center leading-tight">
            Pick the coach that pushes you.
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mt-10 sm:mt-16">
            {COACHES.map((c, i) => (
              <motion.div
                key={c.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className="rounded-2xl border border-border bg-card/40 p-5 sm:p-6 hover-lift"
              >
                <h3 className="font-semibold text-base sm:text-lg">{c.name}</h3>
                <div className="text-primary text-xs mt-1">{c.tag}</div>
                <p className="text-xs text-muted-foreground mt-4 sm:mt-5">"{c.quote}"</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="px-5 sm:px-6 py-16 sm:py-24 md:py-28 border-t border-border/60 scroll-mt-24">

        <div className="max-w-6xl mx-auto">
          <h2 className="font-display text-3xl sm:text-4xl md:text-6xl font-medium text-center leading-tight">
            Choose your edge.
          </h2>
          <p className="text-center text-sm sm:text-base text-muted-foreground mt-4">Start free. Upgrade when the trades pay for it.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 mt-10 sm:mt-16 items-start">
            {PRICING.map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`relative rounded-3xl border p-6 sm:p-8 ${
                  p.popular
                    ? "border-primary/60 bg-card/60 shadow-gold md:-mt-6"
                    : "border-border bg-card/30"
                }`}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full border border-primary/50 bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                    Most popular
                  </div>
                )}
                <div className="text-muted-foreground text-sm">{p.name}</div>
                <div className="mt-3 sm:mt-4 flex items-baseline gap-1">
                  <span className="text-2xl text-muted-foreground">$</span>
                  <span className="font-display text-5xl sm:text-6xl font-medium">{p.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">/month</span>
                </div>
                <Link
                  to="/dashboard"
                  className={`mt-6 sm:mt-8 block text-center rounded-full px-5 py-3 text-sm font-semibold transition ${
                    p.popular
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "bg-foreground text-background hover:opacity-90"
                  }`}
                >
                  Start free trial
                </Link>
                <ul className="mt-6 sm:mt-8 space-y-3 pt-5 sm:pt-6 border-t border-border/60">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <Check className="size-4 text-emerald-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-5 sm:px-6 py-16 sm:py-24 md:py-28 border-t border-border/60 scroll-mt-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10 sm:mb-14">
            <SectionEyebrow>FAQ</SectionEyebrow>
            <h2 className="font-display text-3xl sm:text-4xl md:text-6xl font-medium leading-tight">
              Questions, answered.
            </h2>
            <p className="text-center text-sm sm:text-base text-muted-foreground mt-4 max-w-xl mx-auto px-2">
              The most common things traders ask before getting started.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-border bg-card/40 p-2 sm:p-4"
          >
            <Accordion type="single" collapsible className="w-full">
              {FAQS.map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`faq-${i}`}
                  className="border-border/60 px-2 sm:px-4"
                >
                  <AccordionTrigger className="text-sm sm:text-base font-medium py-4 sm:py-5 hover:no-underline hover:text-primary transition">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>

          <div className="mt-8 sm:mt-10 text-center">
            <Link
              to="/faq"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-5 py-2.5 text-sm font-medium hover:bg-card transition"
            >
              <HelpCircle className="size-4 text-primary" />
              View all FAQ
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative px-5 sm:px-6 py-20 sm:py-28 md:py-32 border-t border-border/60">
        <div className="relative max-w-3xl mx-auto text-center">
          <h2 className="font-display text-4xl sm:text-5xl md:text-7xl font-medium leading-[1.05]">
            The next trade is yours
            <br />
            to <span className="text-primary">win.</span>
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground mt-5 sm:mt-6">Free for 7 days. Cancel anytime.</p>
          <div className="mt-8 sm:mt-10">
            <Link
              to="/dashboard"
              className="group inline-flex items-center gap-2 rounded-full bg-foreground text-background px-7 sm:px-8 py-3.5 sm:py-4 text-sm font-semibold hover:scale-[1.02] transition"
            >
              Get started
              <ArrowRight className="size-4 group-hover:translate-x-0.5 transition" />
            </Link>
          </div>
        </div>
      </section>



      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/60 border-b border-border/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <img src={logoAsset.url} alt="TradeMind" className="h-9 w-9 sm:h-12 sm:w-12 object-contain shrink-0" />
          <span className="font-display text-lg sm:text-2xl font-semibold tracking-tight truncate">TradeMind</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-6 lg:gap-10 text-sm">
          <a href="#product" className="hover:text-primary transition">Product</a>
          <a href="#pricing" className="hover:text-primary transition">Pricing</a>
          <a href="#coaches" className="hover:text-primary transition">Coaches</a>
          <Link to="/faq" className="hover:text-primary transition">FAQ</Link>
        </nav>
        <Link
          to="/dashboard"
          className="rounded-full bg-foreground text-background px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold hover:scale-[1.02] transition shrink-0"
        >
          Get started
        </Link>
      </div>
    </header>
  );
}

function Footer() {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => setYear(new Date().getFullYear()), []);

  const cols = [
    {
      title: "Product",
      items: [
        { label: "Dashboard", to: "/dashboard" as const },
        { label: "Coaches", to: "/coaches" as const },
        { label: "Pricing", to: "/" as const },
        { label: "Mobile App", to: "/" as const },
      ],
    },
    {
      title: "Company",
      items: [
        { label: "About", to: "/" as const },
        { label: "Careers", to: "/" as const },
        { label: "Press", to: "/" as const },
        { label: "Contact", to: "/" as const },
      ],
    },
    {
      title: "Resources",
      items: [
        { label: "Guide", to: "/guide" as const },
        { label: "API docs", to: "/" as const },
        { label: "FAQ", to: "/faq" as const },
      ],
    },
    {
      title: "Legal",
      items: [
        { label: "Privacy", to: "/" as const },
        { label: "Terms", to: "/" as const },
        { label: "Risk disclosure", to: "/" as const },
        { label: "Cookies", to: "/" as const },
      ],
    },
  ];
  return (
    <footer className="border-t border-border/60 px-5 sm:px-6 py-14 sm:py-20 bg-card/20">
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-8 sm:gap-10">
        <div className="col-span-2 md:col-span-1">
          <img src={logoAsset.url} alt="TradeMind" className="h-14 w-14 sm:h-16 sm:w-16 object-contain mb-3 sm:mb-4" />
          <p className="text-sm text-muted-foreground max-w-[240px] leading-relaxed">
            The first AI trading coach. Built for serious day traders, prop traders, and swing traders.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3 sm:mb-4">
              {c.title}
            </div>
            <ul className="space-y-2.5">
              {c.items.map((i) => (
                <li key={i.label}>
                  <Link to={i.to} className="text-sm hover:text-primary transition">{i.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="max-w-7xl mx-auto mt-10 sm:mt-16 pt-6 sm:pt-8 border-t border-border/60 text-xs text-muted-foreground">
        © {new Date().getFullYear()} TradeMind. Educational analysis only, not financial advice.
      </div>
    </footer>
  );
}

function SectionEyebrow({ children, align = "center" }: { children: React.ReactNode; align?: "center" | "left" }) {
  return (
    <div className={`font-mono text-[11px] uppercase tracking-[0.25em] text-primary mb-6 ${align === "center" ? "text-center" : ""}`}>
      {children}
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="size-3.5 text-emerald-400" />
      {children}
    </span>
  );
}

function WatchRow({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 p-2">
      <span className="text-xs font-medium w-16 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">
        <MiniChart symbol={symbol} height={36} dateRange="1D" />
      </div>
    </div>
  );
}

function GradeChip({
  grade,
  color,
  border,
  label,
}: {
  grade: string;
  color: string;
  border: string;
  label: string;
}) {
  return (
    <div className={`rounded-xl border ${border} p-4 text-center`}>
      <div className={`font-display text-3xl ${color}`}>{grade}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-2">{label}</div>
    </div>
  );
}

function BrowserFrame({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/40 overflow-hidden shadow-2xl">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 bg-card/60">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 text-center text-xs text-muted-foreground font-mono">{url}</div>
        <div className="w-12" />
      </div>
      {children}
    </div>
  );
}
