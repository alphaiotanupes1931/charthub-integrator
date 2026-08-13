import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";
import { HELP_CATEGORIES, getArticleBySlug } from "@/lib/help-articles";

export const Route = createFileRoute("/help/$slug")({
  loader: ({ params }) => {
    const article = getArticleBySlug(params.slug);
    if (!article) throw notFound();
    return { article };
  },
  head: ({ loaderData }) => {
    const a = loaderData?.article;
    const title = a ? `${a.title} - TradeMind Help` : "Help - TradeMind";
    const desc = a?.description ?? "TradeMind help articles.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
    };
  },
  errorComponent: () => (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Something went wrong loading this article.
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-6">
      <h1 className="font-display text-2xl">Article not found</h1>
      <p className="text-sm text-muted-foreground">That help article does not exist or was moved.</p>
      <Link to="/help" className="text-sm text-primary hover:underline">Back to help center</Link>
    </div>
  ),
  component: ArticlePage,
});

function ArticlePage() {
  const { article } = Route.useLoaderData();
  const category = HELP_CATEGORIES.find((c) => c.id === article.category);

  return (
    <div className="min-h-screen w-full text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/60 border-b border-border/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoAsset.url} alt="TradeMind" className="h-9 w-9 sm:h-12 sm:w-12 object-contain shrink-0" />
            <span className="font-display text-lg sm:text-2xl font-semibold tracking-tight truncate">TradeMind</span>
          </Link>
          <Link
            to="/help"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-4 py-2 text-xs sm:text-sm font-medium hover:bg-card transition"
          >
            <ArrowLeft className="size-4" />
            All articles
          </Link>
        </div>
      </header>

      <main className="px-5 sm:px-6 py-12 sm:py-16">
        <article className="max-w-3xl mx-auto">
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-6" aria-label="Breadcrumb">
            <Link to="/help" className="hover:text-primary transition">Help</Link>
            <ChevronRight className="size-3" />
            <span>{category?.title}</span>
          </nav>

          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-medium leading-tight">
            {article.title}
          </h1>
          <p className="mt-3 text-base text-muted-foreground">{article.description}</p>

          <div className="mt-8 space-y-5 text-sm sm:text-base leading-relaxed text-foreground/90">
            {article.body.map((para: string, i: number) =>
              para.startsWith("## ") ? (
                <h2 key={i} className="font-display text-xl sm:text-2xl font-medium mt-8">
                  {para.replace(/^##\s+/, "")}
                </h2>
              ) : (
                <p key={i}>{para}</p>
              ),
            )}
          </div>

          <div className="mt-12 rounded-2xl border border-border/60 bg-card/40 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="font-medium">Did this help?</div>
              <div className="text-sm text-muted-foreground">
                If not, ask your AI coach - it has full context on your account.
              </div>
            </div>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold hover:scale-[1.02] transition self-start sm:self-auto"
            >
              Open TradeMind
            </Link>
          </div>
        </article>
      </main>

      <footer className="border-t border-border/60 px-5 sm:px-6 py-10 bg-card/20">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>© 2026 TradeMind. Educational analysis only, not financial advice.</span>
          <div className="flex gap-4">
            <Link to="/help" className="hover:text-primary transition">Help</Link>
            <Link to="/status" className="hover:text-primary transition">Status</Link>
            <Link to="/" className="hover:text-primary transition">Home</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
