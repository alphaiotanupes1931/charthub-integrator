import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, BookOpen, Search, ArrowRight } from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";
import { HELP_ARTICLES, HELP_CATEGORIES, getArticlesByCategory } from "@/lib/help-articles";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help Center — TradeMind" },
      {
        name: "description",
        content:
          "Guides and answers for using TradeMind: onboarding, AI coaching, broker connections, billing, privacy, and account safety.",
      },
      { property: "og:title", content: "Help Center — TradeMind" },
      {
        property: "og:description",
        content:
          "Guides and answers for using TradeMind: onboarding, AI coaching, broker connections, billing, privacy, and account safety.",
      },
    ],
  }),
  component: HelpCenter,
});

function HelpCenter() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return HELP_ARTICLES.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.body.join(" ").toLowerCase().includes(q),
    );
  }, [query]);

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
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10 sm:mb-14"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-xs mb-6">
              <BookOpen className="size-3.5 text-primary" />
              <span className="text-muted-foreground">Help center</span>
            </div>
            <h1 className="font-display text-3xl sm:text-5xl md:text-6xl font-medium leading-tight">
              How can we help?
            </h1>
            <p className="mt-4 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
              Guides for getting set up, working with the AI coach, and managing your account.
            </p>

            <div className="mt-8 max-w-xl mx-auto relative">
              <Search className="size-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search articles…"
                className="w-full rounded-full border border-border bg-card/60 pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Search help articles"
              />
            </div>
          </motion.div>

          {results ? (
            <section aria-label="Search results" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {results.length} {results.length === 1 ? "result" : "results"} for "{query}"
              </p>
              {results.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
                  Nothing matched. Try a different word, or browse the categories below.
                </div>
              ) : (
                <ul className="grid gap-3">
                  {results.map((a) => (
                    <li key={a.slug}>
                      <Link
                        to="/help/$slug"
                        params={{ slug: a.slug }}
                        className="block rounded-xl border border-border bg-card/40 hover:bg-card/70 transition p-4 sm:p-5"
                      >
                        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                          {HELP_CATEGORIES.find((c) => c.id === a.category)?.title}
                        </div>
                        <div className="font-medium">{a.title}</div>
                        <div className="text-sm text-muted-foreground mt-1">{a.description}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
              {HELP_CATEGORIES.map((cat) => {
                const articles = getArticlesByCategory(cat.id);
                return (
                  <section
                    key={cat.id}
                    className="rounded-2xl border border-border bg-card/40 p-5 sm:p-6"
                  >
                    <h2 className="font-display text-xl font-medium">{cat.title}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{cat.description}</p>
                    <ul className="mt-4 divide-y divide-border/60">
                      {articles.map((a) => (
                        <li key={a.slug}>
                          <Link
                            to="/help/$slug"
                            params={{ slug: a.slug }}
                            className="flex items-center justify-between gap-3 py-3 text-sm hover:text-primary transition"
                          >
                            <span>{a.title}</span>
                            <ArrowRight className="size-4 shrink-0 opacity-60" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}

          <div className="mt-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">Still stuck?</p>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-6 py-3 text-sm font-semibold hover:scale-[1.02] transition"
            >
              Ask your AI coach
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 px-5 sm:px-6 py-10 bg-card/20">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>© 2026 TradeMind. Educational analysis only, not financial advice.</span>
          <div className="flex gap-4">
            <Link to="/status" className="hover:text-primary transition">Status</Link>
            <Link to="/faq" className="hover:text-primary transition">FAQ</Link>
            <Link to="/" className="hover:text-primary transition">Home</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
