import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, ExternalLink, Info, Layers3, Library, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useAnalysisModel } from "@/hooks/useAnalysisModel";
import { ANALYSIS_MODELS, type AnalysisModel } from "@/lib/analysis-models";

export const Route = createFileRoute("/_app/strategies/alt-strategies")({
  head: () => ({
    meta: [
      { title: "Alt. Strategies — TradeMind" },
      {
        name: "description",
        content: "Compare and select alternate professional-trader rulebooks for TradeMind scans, coaching, and signal grading.",
      },
      { property: "og:title", content: "Alt. Strategies — TradeMind" },
      {
        property: "og:description",
        content: "Compare and select alternate professional-trader rulebooks for TradeMind scans, coaching, and signal grading.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltStrategiesPage,
});

function modelNumber(model: AnalysisModel): string {
  const index = ANALYSIS_MODELS.findIndex((item) => item.id === model.id);
  return `Model ${index + 1}`;
}

function AltStrategiesPage() {
  const { modelId, select, saving } = useAnalysisModel();
  const [openInfoId, setOpenInfoId] = useState<string | null>(null);
  const activeModel = ANALYSIS_MODELS.find((model) => model.id === modelId) ?? ANALYSIS_MODELS[0];

  async function chooseModel(model: AnalysisModel) {
    if (model.id === modelId || !model.ready) return;
    const result = await select(model.id);
    if (result?.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${model.name} is now your active alt. strategy`);
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Alt. Strategies"
        icon={<ScanSearch className="h-7 w-7 text-primary" />}
        description="Choose the outside professional-trader methodology used by the scan coach for chart analysis, grades, entries, stops, and targets."
        instructions={false}
      />

      <section className="mb-6 rounded-md border border-border/60 bg-card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
            <Library className="h-4 w-4 text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-lg font-semibold">How Alt. Strategies are different</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Regular Strategies are your own trading playbooks: risk rules, sessions, entry rules, and exit rules that scans are checked against. Alt. Strategies are separate scan-coach rulebooks built from professional trader videos, transcripts, and source material, then kept isolated so each one can build its own track record.
            </p>
            <Link to="/strategies" search={{ edit: undefined }} className="inline-flex text-xs font-medium text-primary hover:underline">
              View regular strategies
            </Link>
          </div>
        </div>
      </section>

      <section className="mb-7 border-y border-border/60 py-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Active alt. strategy</p>
            <h2 className="mt-1 font-display text-xl font-semibold">{activeModel.name}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{activeModel.tagline}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <Check className="h-3.5 w-3.5" /> Active
          </span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {ANALYSIS_MODELS.map((model) => {
          const isActive = model.id === modelId;
          const infoOpen = openInfoId === model.id;
          return (
            <article
              key={model.id}
              className={`flex flex-col rounded-md border bg-card p-5 transition-colors ${
                isActive ? "border-primary/60" : "border-border/60 hover:border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background">
                  <Layers3 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-[11px] font-medium">
                  <span className="rounded border border-border/60 px-2 py-1 text-muted-foreground">{modelNumber(model)}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant={infoOpen ? "secondary" : "ghost"}
                    className="h-7 w-7 shrink-0"
                    aria-label={`${infoOpen ? "Hide" : "Show"} details for ${model.name}`}
                    aria-expanded={infoOpen}
                    onClick={() => setOpenInfoId(infoOpen ? null : model.id)}
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-5">
                <h2 className="font-display text-xl font-semibold">{model.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{model.tagline}</p>
                <div className="mt-4">
                  <p className="text-[11px] font-semibold uppercase text-muted-foreground">Related strategies</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {model.relatedStrategies.map((strategy) => (
                      <span key={strategy} className="rounded border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground">
                        {strategy}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {infoOpen && (
                <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
                  <p className="text-xs leading-6 text-muted-foreground">{model.description}</p>
                  {!model.ready && model.notReadyReason && (
                    <p className="border-l-2 border-primary/50 pl-3 text-xs leading-relaxed text-muted-foreground">
                      {model.notReadyReason}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-muted-foreground">Version</span>
                    <span className="max-w-[70%] truncate font-mono text-foreground" title={model.version}>{model.version}</span>
                  </div>
                  {model.sourceUrl && (
                    <a
                      href={model.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      {model.sourceLabel ?? "View source material"}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              <div className="mt-5 border-t border-border/60 pt-4">
                <Button
                  className="w-full"
                  variant={isActive ? "outline" : "default"}
                  disabled={isActive || saving || !model.ready}
                  onClick={() => void chooseModel(model)}
                >
                  {isActive ? <><Check /> Active alt. strategy</> : `Use ${model.name}`}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}