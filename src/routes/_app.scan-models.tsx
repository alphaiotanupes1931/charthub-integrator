import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Check, ExternalLink, Layers3, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useAnalysisModel } from "@/hooks/useAnalysisModel";
import { ANALYSIS_MODELS, type AnalysisModel } from "@/lib/analysis-models";

export const Route = createFileRoute("/_app/scan-models")({
  head: () => ({
    meta: [
      { title: "Scan Models — TradeMind" },
      {
        name: "description",
        content: "Compare and select the rulebook TradeMind uses for chart analysis, scans, and signal grading.",
      },
      { property: "og:title", content: "Scan Models — TradeMind" },
      {
        property: "og:description",
        content: "Compare and select the rulebook TradeMind uses for chart analysis, scans, and signal grading.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScanModelsPage,
});

function modelNumber(model: AnalysisModel): string {
  const index = ANALYSIS_MODELS.findIndex((item) => item.id === model.id);
  return `Model ${index + 1}`;
}

function ScanModelsPage() {
  const { modelId, select, saving } = useAnalysisModel();
  const activeModel = ANALYSIS_MODELS.find((model) => model.id === modelId) ?? ANALYSIS_MODELS[0];

  async function chooseModel(model: AnalysisModel) {
    if (model.id === modelId || !model.ready) return;
    const result = await select(model.id);
    if (result?.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${model.name} is now your active scan model`);
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Scan Models"
        icon={<ScanSearch className="h-7 w-7 text-primary" />}
        description="Choose the rulebook used for chart analysis, scan grades, entries, stops, and targets. Each model keeps its own methodology and track record."
        instructions={false}
      />

      <section className="mb-7 border-y border-border/60 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">Active scan model</p>
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
          return (
            <article
              key={model.id}
              className={`flex min-h-[430px] flex-col rounded-md border bg-card p-5 transition-colors ${
                isActive ? "border-primary/60" : "border-border/60 hover:border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border/60 bg-background">
                  <Layers3 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-[11px] font-medium">
                  <span className="rounded border border-border/60 px-2 py-1 text-muted-foreground">{modelNumber(model)}</span>
                  <span className={`rounded border px-2 py-1 ${model.ready ? "border-bull/40 text-bull" : "border-border text-muted-foreground"}`}>
                    {model.ready ? "Ready" : "Not ready"}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <h2 className="font-display text-xl font-semibold">{model.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{model.tagline}</p>
              </div>

              <div className="my-5 border-t border-border/60" />

              <div className="flex-1">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <BookOpen className="h-3.5 w-3.5 text-primary" /> What makes it different
                </div>
                <p className="text-xs leading-6 text-muted-foreground">{model.description}</p>
                {!model.ready && model.notReadyReason && (
                  <p className="mt-3 border-l-2 border-primary/50 pl-3 text-xs leading-relaxed text-muted-foreground">
                    {model.notReadyReason}
                  </p>
                )}
              </div>

              <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
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
                <Button
                  className="w-full"
                  variant={isActive ? "outline" : "default"}
                  disabled={isActive || saving || !model.ready}
                  onClick={() => void chooseModel(model)}
                >
                  {isActive ? <><Check /> Active model</> : `Use ${model.name}`}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}