import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowLeft, HelpCircle } from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — TradeMind" },
      {
        name: "description",
        content:
          "Answers to common questions about TradeMind, the AI trading coach, broker connections, data security, and pricing.",
      },
      { property: "og:title", content: "FAQ — TradeMind" },
      {
        property: "og:description",
        content:
          "Answers to common questions about TradeMind, the AI trading coach, broker connections, data security, and pricing.",
      },
    ],
  }),
  component: FAQPage,
});

const FAQS = [
  {
    q: "What is TradeMind?",
    a: "TradeMind is an AI trading coach that grades your setups before you risk capital. It reads structure, momentum, risk-reward, and your personal track record to help you take only the trades that deserve to win.",
  },
  {
    q: "Is TradeMind a broker?",
    a: "No. TradeMind does not hold funds or execute trades. You can connect supported brokers to import trade history and see your analytics inside TradeMind, but execution stays with your broker.",
  },
  {
    q: "How does the AI coach know what I am trading?",
    a: "You can paste a chart screenshot, describe your setup in chat, or connect your broker so the AI sees your recent positions. The coach then grades the setup and explains its reasoning in the voice you selected.",
  },
  {
    q: "Which markets does TradeMind support?",
    a: "TradeMind covers forex, crypto, indices, commodities, and major equities. Live charts and scanning work across the most liquid symbols including XAU/USD, BTC/USD, NAS100, SPX, EUR/USD, and US30.",
  },
  {
    q: "Can I change my AI coach?",
    a: "Yes. TradeMind offers five coaching personalities, from the disciplined Analyst to the aggressive Beast. You can switch coaches in the Coaches tab or from the dashboard at any time.",
  },
  {
    q: "Is my trade data secure?",
    a: "Yes. We use encrypted connections, row-level security in the backend, and never share your raw trade history with third parties. Broker credentials are handled through OAuth or secure tokens where supported.",
  },
  {
    q: "Does TradeMind give financial advice?",
    a: "No. TradeMind is educational analysis only. The AI coach helps you build discipline and review your process, but every trading decision is yours. Past performance does not guarantee future results.",
  },
  {
    q: "How do I cancel or change my plan?",
    a: "You can upgrade, downgrade, or cancel from your account settings at any time. If you cancel during your 7-day trial you will not be charged.",
  },
];

function FAQPage() {
  return (
    <div className="min-h-screen w-full text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/60 border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoAsset.url} alt="TradeMind" className="h-9 w-9 sm:h-12 sm:w-12 object-contain shrink-0" />
            <span className="font-display text-lg sm:text-2xl font-semibold tracking-tight truncate">TradeMind</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-4 py-2 text-xs sm:text-sm font-medium hover:bg-card transition"
          >
            <ArrowLeft className="size-4" />
            Back home
          </Link>
        </div>
      </header>

      <main className="px-5 sm:px-6 py-16 sm:py-24">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10 sm:mb-14"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs mb-6">
              <HelpCircle className="size-3.5 text-primary" />
              <span className="text-muted-foreground">Got questions?</span>
            </div>
            <h1 className="font-display text-3xl sm:text-5xl md:text-6xl font-medium leading-tight">
              Frequently asked questions
            </h1>
            <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
              Everything you need to know about TradeMind, coaching, and your data.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-2xl border border-border bg-card/40 p-2 sm:p-4"
          >
            <Accordion type="single" collapsible className="w-full">
              {FAQS.map((item, i) => (
                <AccordionItem
                  key={i}
                  value={`item-${i}`}
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

          <div className="mt-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">Still have questions?</p>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:scale-[1.02] transition"
            >
              Chat with TradeMind
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 px-5 sm:px-6 py-10 bg-card/20">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>© 2026 TradeMind. Educational analysis only, not financial advice.</span>
          <Link to="/" className="hover:text-primary transition">Back to home</Link>
        </div>
      </footer>
    </div>
  );
}
