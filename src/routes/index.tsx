import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowRight, Check, Menu } from "lucide-react";
import { TickerTape } from "@/components/TickerTape";
import { MiniChart, SymbolOverview } from "@/components/MiniChart";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetTrigger, SheetClose } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/logo.png.asset.json";
import dashboardPreview from "@/assets/dashboard-preview.png.asset.json";
import gradeCard from "@/assets/grade-card.png.asset.json";
import trader1 from "@/assets/trader-1.jpg";
import trader2 from "@/assets/trader-2.jpg";
import trader3 from "@/assets/trader-3.jpg";
import trader4 from "@/assets/trader-4.jpg";

const TRADER_AVATARS: string[] = [trader1, trader2, trader3, trader4];



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TradeMind — Setup grading for active traders" },
      {
        name: "description",
        content:
          "TradeMind grades every trade setup on structure, risk, and confluence. Take the ones that meet your rules. Skip the rest.",
      },
      { property: "og:title", content: "TradeMind — Setup grading for active traders" },
      {
        property: "og:description",
        content: "Grade every setup A+ to No Entry. Journal, review, improve.",
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

const PRICING = [
  {
    name: "Basic",
    price: 49,
    features: ["1 instrument", "Setup grading", "Trade journal", "Web access"],
    popular: false,
  },
  {
    name: "Pro",
    price: 97,
    features: ["5 instruments", "Pattern detection", "Voice coach", "Broker import", "Mobile app"],
    popular: true,
  },
  {
    name: "Elite",
    price: 197,
    features: ["Unlimited instruments", "Custom strategies", "Priority scans", "Direct support"],
    popular: false,
  },
];

const FAQS = [
  {
    q: "What is TradeMind?",
    a: "A trade review tool. It grades your setup on structure, risk, and confluence before you take it, and logs the trade for review afterward.",
  },
  {
    q: "Is TradeMind a broker?",
    a: "No. TradeMind does not hold funds or place orders. You can connect a supported broker to import history. Execution stays with your broker.",
  },
  {
    q: "How does the grading work?",
    a: "Every setup is scored A+ through No Entry across six dimensions: structure, momentum, risk, confluence, session, and your own track record.",
  },
  {
    q: "Is my data secure?",
    a: "Encrypted connections, row-level access controls, and no sharing of raw trade history with third parties.",
  },
];

// Hero uses a single staggered entrance. Nothing else on the page animates on load.
const heroContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] as const } },
};

function Landing() {
  const [isAuthed, setIsAuthed] = useState(false);
  const dashboardHref = isAuthed ? "/dashboard" : "/auth?mode=signin&redirect=%2Fdashboard";
  const signupHref = "/auth?mode=signup&redirect=%2Fpricing";
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setIsAuthed(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
  return (
    <div className="min-h-screen w-full text-foreground">
      <Nav isAuthed={isAuthed} />

      {/* COVER — Instagram-style: compact split, product shot on the right, pill actions. */}
      <section className="px-5 sm:px-6 pt-14 sm:pt-20 pb-14 sm:pb-20 border-b border-border/60">
        <motion.div
          variants={heroContainer}
          initial="hidden"
          animate="show"
          className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_minmax(0,1.05fr)] gap-12 lg:gap-16 items-center"
        >
          <div className="text-center lg:text-left">
            <motion.div
              variants={heroItem}
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5"
            >
              <img
                src={logoAsset.url}
                alt="TradeMind"
                className="h-5 w-5 rounded-full"
                loading="eager"
              />
              <span className="text-[11px] font-semibold tracking-tight">TradeMind</span>
              <span className="h-1 w-1 rounded-full bg-border" />
              <span className="text-[11px] text-muted-foreground">Public beta</span>
            </motion.div>

            <motion.h1
              variants={heroItem}
              className="font-display font-semibold tracking-[-0.03em] leading-[1.05] mt-6 text-[2rem] sm:text-[2.5rem] lg:text-[2.9rem] xl:text-[3.2rem]"
            >
              Grade the setup.
              <br />
              Take the trade.
            </motion.h1>

            <motion.p
              variants={heroItem}
              className="mt-5 text-base sm:text-[17px] text-muted-foreground max-w-md mx-auto lg:mx-0 leading-relaxed"
            >
              TradeMind scores every setup on structure, risk, and confluence, so you take the
              ones that meet your rules and skip the rest.
            </motion.p>

            <motion.div
              variants={heroItem}
              className="mt-8 flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-3"
            >
              <a
                href={dashboardHref}
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground px-6 py-3 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Open dashboard
                <ArrowRight className="size-4" />
              </a>
              <a
                href={signupHref}
                className="inline-flex w-full sm:w-auto items-center justify-center rounded-full border border-border/60 bg-card px-6 py-3 text-sm font-semibold hover:bg-muted/60 transition-colors"
              >
                Start free trial
              </a>
            </motion.div>

            <motion.div
              variants={heroItem}
              className="mt-6 flex flex-col sm:flex-row items-center lg:justify-start justify-center gap-x-4 gap-y-3"
            >
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {TRADER_AVATARS.map((src, i) => (
                    <img
                      key={src}
                      src={src}
                      alt={`TradeMind trader ${i + 1}`}
                      width={512}
                      height={512}
                      loading="lazy"
                      className="h-7 w-7 rounded-full border-2 border-background object-cover bg-muted"
                    />
                  ))}
                </div>

                <span className="text-xs text-muted-foreground">
                  Traders grading setups daily
                </span>
              </div>
            </motion.div>

            {!isAuthed && (
              <motion.div variants={heroItem} className="mt-5 text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  to="/auth"
                  search={{ mode: "signin" }}
                  className="text-primary font-semibold hover:underline"
                >
                  Log in
                </Link>
              </motion.div>
            )}

            <motion.div
              variants={heroItem}
              className="mt-6 flex flex-wrap items-center lg:justify-start justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground"
            >
              <Bullet>7-day free trial</Bullet>
              <Bullet>Cancel anytime</Bullet>
              <Bullet>No card to browse</Bullet>
            </motion.div>
          </div>

          <motion.div variants={heroItem} className="relative">
            <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
                <img src={logoAsset.url} alt="" className="h-5 w-5 rounded-full" loading="lazy" />
                <span className="text-xs font-semibold tracking-tight">Dashboard</span>
                <span className="ml-auto text-[10px] text-muted-foreground">Live</span>
              </div>
              <img
                src={dashboardPreview.url}
                alt="TradeMind dashboard preview showing the gold chart, timeframes, and sidebar navigation"
                className="block w-full h-auto"
                loading="lazy"
              />
            </div>
          </motion.div>
        </motion.div>
      </section>



      {/* TICKER */}
      <div className="border-b border-border/60 bg-card">
        <TickerTape symbols={TICKER} />
      </div>

      {/* HOW IT WORKS */}
      <section id="product" className="px-5 sm:px-6 py-16 sm:py-24 border-b border-border/60 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <SectionEyebrow>How it works</SectionEyebrow>
          <h2 className="font-display font-semibold tracking-[-0.03em] text-[1.75rem] sm:text-4xl md:text-[2.75rem] text-center leading-tight">
            Three steps, chart to decision.
          </h2>
          <p className="text-center text-sm sm:text-base text-muted-foreground mt-4 max-w-xl mx-auto">
            Under thirty seconds from a chart to a grade you can act on.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-14">
            {[
              {
                step: "01",
                title: "Load the setup",
                body: "Connect a chart or paste a screenshot. TradeMind reads structure, sweeps, breaks, and retests.",
              },
              {
                step: "02",
                title: "Read the grade",
                body: "Every setup gets a letter grade A+ through No Entry, scored on confluence, risk, and your strategy.",
              },
              {
                step: "03",
                title: "Take A and A+",
                body: "Skip the B and C setups. Your entries, stops, and journal notes are logged automatically.",
              },
            ].map((s) => (
              <div
                key={s.step}
                className="rounded-xl border border-border/60 bg-card p-6 sm:p-8"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Step {s.step}</div>
                <h3 className="font-display text-xl sm:text-2xl mt-4">{s.title}</h3>
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GRADING SECTION */}
      <section className="px-5 sm:px-6 py-16 sm:py-24 border-b border-border/60">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <SectionEyebrow align="left">Signal grading</SectionEyebrow>
            <h2 className="font-display font-semibold tracking-[-0.03em] text-[1.75rem] sm:text-4xl md:text-[2.75rem] leading-tight tracking-tight">
              Score every setup on six dimensions.
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground mt-5 leading-relaxed max-w-md">
              Structure, momentum, risk, confluence, session, and your own track record. Only A and A+ setups earn real capital.
            </p>
            <div className="grid grid-cols-4 gap-3 mt-10 max-w-md">
              <GradeChip grade="A+" color="text-primary" border="border-primary" label="Take it" />
              <GradeChip grade="A" color="text-bull" border="border-border/60" label="Strong" />
              <GradeChip grade="B" color="text-foreground/80" border="border-border/60" label="Optional" />
              <GradeChip grade="C" color="text-destructive" border="border-border/60" label="Skip" />
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-2 sm:p-3">
            <img
              src={gradeCard.url}
              alt="TradeMind grade card showing a B grade XAU/USD long setup with entry, stop, TP1, TP2, confidence, trend, volume, order flow, and volatility readings"
              className="block w-full h-auto rounded-lg"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="px-5 sm:px-6 py-16 sm:py-24 border-b border-border/60 scroll-mt-24">
        <div className="max-w-6xl mx-auto">
          <SectionEyebrow>Pricing</SectionEyebrow>
          <h2 className="font-display font-semibold tracking-[-0.03em] text-[1.75rem] sm:text-4xl md:text-[2.75rem] text-center leading-tight">
            Plans that scale with your trading.
          </h2>
          <p className="text-center text-sm sm:text-base text-muted-foreground mt-4">
            Start on Basic. Move up when the trades pay for it.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-14 items-start">
            {PRICING.map((p) => (
              <div
                key={p.name}
                className={`relative rounded-xl border p-6 sm:p-8 bg-card ${
                  p.popular ? "border-primary" : "border-border/60"
                }`}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full border border-primary bg-background px-2.5 py-1 text-[10px] font-medium tracking-tight text-primary">
                    Most popular
                  </div>
                )}
                <div className="text-muted-foreground text-sm">{p.name}</div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-2xl text-muted-foreground">$</span>
                  <span className="font-display text-5xl sm:text-6xl">{p.price}</span>
                  <span className="text-sm text-muted-foreground ml-1">/month</span>
                </div>
                <a
                  href={isAuthed ? "/dashboard" : signupHref}
                  className={`mt-6 block text-center rounded-full px-5 py-3 text-sm font-semibold border ${
                    p.popular
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-foreground text-background border-foreground"
                  }`}
                >
                  Start free trial
                </a>
                <ul className="mt-6 space-y-3 pt-5 border-t border-border/60">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <Check className="size-4 text-bull shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-5 sm:px-6 py-16 sm:py-24 border-b border-border/60 scroll-mt-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <SectionEyebrow>FAQ</SectionEyebrow>
            <h2 className="font-display font-semibold tracking-[-0.03em] text-[1.75rem] sm:text-4xl md:text-[2.75rem] leading-tight">
              Common questions.
            </h2>
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-2 sm:p-4">
            <Accordion type="single" collapsible className="w-full">
              {FAQS.map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`faq-${i}`}
                  className="border-border/60 px-2 sm:px-4"
                >
                  <AccordionTrigger className="text-sm sm:text-base font-medium py-4 hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <div className="mt-10 text-center">
            <Link
              to="/faq"
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-5 py-2.5 text-sm font-medium hover:bg-muted/60 transition-colors"
            >
              View all FAQ
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-5 sm:px-6 py-20 sm:py-28 border-b border-border/60">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display font-semibold tracking-[-0.03em] text-[2rem] sm:text-4xl md:text-[3rem] leading-tight">
            Grade the next trade.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground mt-5">Free for 7 days. Cancel anytime.</p>
          <div className="mt-10">
            <a
              href={dashboardHref}
              className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-7 py-3.5 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Open dashboard
              <ArrowRight className="size-4" />
            </a>
          </div>
        </div>
      </section>

      <Footer dashboardHref={dashboardHref} />
    </div>
  );
}

function Nav({ isAuthed }: { isAuthed: boolean }) {
  const dashboardHref = isAuthed ? "/dashboard" : "/auth?mode=signin&redirect=%2Fdashboard";
  return (
    <header className="sticky top-0 z-40 bg-background border-b border-border/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <img src={logoAsset.url} alt="TradeMind" className="h-8 w-8 object-contain shrink-0" />
          <span className="font-display text-lg font-semibold tracking-tight truncate">TradeMind</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#product" className="hover:text-foreground transition-colors">Product</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          <Link to="/coaches" className="hover:text-foreground transition-colors">Coaches</Link>
          <Link to="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          <Sheet>
            <SheetTrigger asChild>
              <button
                className="sm:hidden inline-flex items-center justify-center rounded-full border border-border/60 bg-card p-2"
                aria-label="Open menu"
              >
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[280px] bg-background border-border/60 p-6">
              <div className="flex flex-col gap-6 mt-10">
                <SheetClose asChild>
                  <a href="#product" className="text-lg font-medium">Product</a>
                </SheetClose>
                <SheetClose asChild>
                  <a href="#pricing" className="text-lg font-medium">Pricing</a>
                </SheetClose>
                <SheetClose asChild>
                  <Link to="/coaches" className="text-lg font-medium">Coaches</Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link to="/faq" className="text-lg font-medium">FAQ</Link>
                </SheetClose>
                <SheetClose asChild>
                  <a
                    href={dashboardHref}
                    className="mt-4 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground px-5 py-3 text-sm font-semibold"
                  >
                    Open dashboard
                  </a>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
          <a
            href={dashboardHref}
            className="hidden sm:inline-flex rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Open dashboard
          </a>
        </div>
      </div>
    </header>
  );
}

function Footer({ dashboardHref }: { dashboardHref: string }) {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => setYear(new Date().getFullYear()), []);

  const cols = [
    {
      title: "Product",
      items: [
        { label: "Dashboard", href: dashboardHref },
        { label: "Coaches", to: "/coaches" as const },
        { label: "Pricing", to: "/pricing" as const },
      ],
    },
    {
      title: "Resources",
      items: [
        { label: "Guide", to: "/guide" as const },
        { label: "Help center", to: "/help" as const },
        { label: "FAQ", to: "/faq" as const },
        { label: "Status", to: "/status" as const },
      ],
    },
    {
      title: "Legal",
      items: [
        { label: "Privacy", to: "/privacy" as const },
        { label: "Terms", to: "/terms" as const },
        { label: "Cookies", to: "/cookies" as const },
      ],
    },
  ];
  return (
    <footer className="px-5 sm:px-6 pt-14 pb-10 bg-card">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2">
            <img src={logoAsset.url} alt="TradeMind" className="h-7 w-7 rounded-full" loading="lazy" />
            <span className="font-display text-base font-semibold tracking-[-0.02em]">TradeMind</span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground max-w-[240px] leading-relaxed">
            Setup grading and trade review for active day, swing, and prop traders.
          </p>
          <a
            href={dashboardHref}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Open dashboard
            <ArrowRight className="size-4" />
          </a>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-4">
              {c.title}
            </div>
            <ul className="space-y-2.5">
              {c.items.map((i) => (
                <li key={i.label}>
                  {"href" in i ? (
                    <a href={i.href} className="text-sm hover:text-foreground transition-colors text-muted-foreground">
                      {i.label}
                    </a>
                  ) : (
                    <Link to={i.to} className="text-sm hover:text-foreground transition-colors text-muted-foreground">
                      {i.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>© {year ?? "2026"} TradeMind. Educational analysis only. Not financial advice.</span>
        <span className="flex items-center gap-4">
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          <Link to="/status" className="hover:text-foreground transition-colors">Status</Link>
        </span>
      </div>
    </footer>

  );
}

function SectionEyebrow({ children, align = "center" }: { children: React.ReactNode; align?: "center" | "left" }) {
  return (
    <div className={`mb-6 flex ${align === "center" ? "justify-center" : "justify-start"}`}>
      <span className="inline-flex items-center rounded-full border border-border/60 bg-card px-3 py-1 text-[11px] font-semibold tracking-tight text-muted-foreground">
        {children}
      </span>
    </div>
  );
}


function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Check className="size-3.5 text-bull" />
      {children}
    </span>
  );
}

function WatchRow({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background p-2">
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
    <div className={`rounded-xl border ${border} p-4 text-center bg-card`}>
      <div className={`font-display text-3xl ${color}`}>{grade}</div>
      <div className="text-[10px] font-medium tracking-tight text-muted-foreground mt-2">{label}</div>
    </div>
  );
}
