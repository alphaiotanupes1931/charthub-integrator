import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { LogoLink } from "@/components/LogoLink";
import { TRADER_TYPES } from "@/lib/trader-profile/config";
import { TYPE_SLUGS, SHARE_IMAGES, absolute } from "@/lib/trader-profile/share";

/** Shareable landing page per trader type; carries the link preview image. */
export const Route = createFileRoute("/quiz/$type")({
  loader: ({ params }) => {
    const id = TYPE_SLUGS[params.type];
    if (!id) throw notFound();
    return { id };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "What's your trader type? — TradeMind" }] };
    const t = TRADER_TYPES[loaderData.id];
    const img = absolute(SHARE_IMAGES[loaderData.id].og);
    const title = `I'm ${t.name}. What's your trader type?`;
    return {
      meta: [
        { title: `${t.name} — TradeMind trader types` },
        { name: "description", content: t.short + " Take the 60-second quiz to find your trader type." },
        { property: "og:title", content: title },
        { property: "og:description", content: t.short + " Take the 60-second quiz." },
        { property: "og:type", content: "website" },
        { property: "og:image", content: img },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: img },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div><p className="mb-4">That trader type doesn't exist.</p><Link to="/quiz" className="text-primary underline">Take the quiz</Link></div>
    </div>
  ),
  errorComponent: () => (
    <div className="min-h-screen flex items-center justify-center p-6"><Link to="/quiz" className="text-primary underline">Take the quiz</Link></div>
  ),
  component: TypePage,
});

function TypePage() {
  const { id } = Route.useLoaderData();
  const t = TRADER_TYPES[id];
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="w-full max-w-md mx-auto">
        <LogoLink to="/" size="lg" variant="brand" textClassName="text-xl" className="justify-center mb-8" />
        <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
          <img src={SHARE_IMAGES[id].og} alt={t.name} className="w-full rounded-xl border border-border/60" />
          <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
          <p className="text-sm text-muted-foreground">{t.read}</p>
          <Button asChild className="w-full h-11"><Link to="/quiz">What's your trader type?</Link></Button>
        </div>
      </div>
    </div>
  );
}
