import { useState } from "react";
import { Check, ChevronDown, Info, Layers } from "lucide-react";
import { toast } from "sonner";
import { ANALYSIS_MODELS, getAnalysisModel } from "@/lib/analysis-models";
import { useAnalysisModel } from "@/hooks/useAnalysisModel";

/**
 * Picks the named analysis model, the way you pick a model in ChatGPT. The
 * choice is saved to the account and sent with every coach request.
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
        className="inline-flex items-center gap-1.5 border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
      >
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-[9rem] truncate">{active.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-[19rem] border border-border/60 bg-card p-1 shadow-none">
            {ANALYSIS_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (m.id === modelId) return;
                  void select(m.id).then((r) => {
                    if (r?.error) toast.error(r.error.message);
                    else toast.success(`Now using ${m.name}`);
                  });
                }}
                className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-muted"
              >
                <Check
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${m.id === modelId ? "text-foreground" : "text-transparent"}`}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {m.name}
                    {!m.ready ? (
                      <span className="border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Empty
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{m.tagline}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground/80">{m.version}</span>
                  {!m.ready && m.notReadyReason ? (
                    <span className="mt-1 block text-[11px] text-muted-foreground">{m.notReadyReason}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
