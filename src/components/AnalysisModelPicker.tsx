import { useState } from "react";
import { Check, ChevronDown, Info, Layers } from "lucide-react";
import { toast } from "sonner";
import { ANALYSIS_MODELS, getAnalysisModel } from "@/lib/analysis-models";
import { useAnalysisModel } from "@/hooks/useAnalysisModel";

/**
 * Picks the named analysis model, the way you pick a model in ChatGPT. The
 * choice is saved to the account and sent with every coach request. Lives in
 * the dashboard toolbar only - chat headers just show the active model.
 */
export function AnalysisModelPicker({ className = "" }: { className?: string }) {
  const { modelId, select, saving } = useAnalysisModel();
  const [open, setOpen] = useState(false);
  const [infoFor, setInfoFor] = useState<string | null>(null);
  const active = getAnalysisModel(modelId);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-label="Analysis model"
        className="dashboard-control inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-foreground transition disabled:opacity-50"
      >
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[10rem] truncate">{active.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-border/60 bg-card p-1 shadow-xl">
            {ANALYSIS_MODELS.map((m) => (
              <div key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (m.id === modelId) return;
                    void select(m.id).then((r) => {
                      if (r?.error) toast.error(r.error.message);
                      else toast.success(`Now using ${m.name}`);
                    });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted rounded-xl"
                >
                  <Check
                    className={`h-3.5 w-3.5 shrink-0 ${m.id === modelId ? "text-foreground" : "text-transparent"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {m.name}
                  </span>
                  {!m.ready ? (
                    <span className="border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Empty
                    </span>
                  ) : null}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`About ${m.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setInfoFor((v) => (v === m.id ? null : m.id));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setInfoFor((v) => (v === m.id ? null : m.id));
                      }
                    }}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </button>
                {infoFor === m.id ? (
                  <div className="mx-3 mb-2 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                    <p className="text-xs text-muted-foreground">{m.tagline}</p>
                    <p className="mt-1.5">{m.description}</p>
                    <p className="mt-1.5 text-muted-foreground/80">{m.version}</p>
                    {!m.ready && m.notReadyReason ? <p className="mt-1">{m.notReadyReason}</p> : null}
                    {m.sourceUrl ? (
                      <a
                        href={m.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 block font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
                      >
                        {m.sourceLabel ?? m.sourceUrl}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
