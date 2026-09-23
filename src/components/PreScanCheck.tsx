import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ClipboardCheck, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { pickPreScanQuestions, type PreScanQuestion } from "@/lib/prescan-questions";
import { buildChartQuestions, readChartFacts, type ChartFacts, type PreScanBar } from "@/lib/prescan-context";
import { reviewPreScanAnswers } from "@/lib/prescan-check.functions";
import { ANALYSIS_MODELS, type AnalysisModelId } from "@/lib/analysis-models";
import { cn } from "@/lib/utils";

/**
 * Confirmation checklist shown before a scan runs. The trader answers a few
 * questions about the confirmations this model needs, then sees the right
 * answers with coach feedback, then continues to the scan. Answers never change
 * the scan itself - this is the teaching step.
 */
export function PreScanCheck({
  open,
  modelId,
  symbol,
  ticker,
  interval,
  timeframe,
  onCancel,
  onContinue,
}: {
  open: boolean;
  modelId: AnalysisModelId;
  symbol?: string;
  /** Raw ticker for the OHLC feed, e.g. "XAU/USD". */
  ticker?: string;
  /** Raw chart interval for the OHLC feed, e.g. "60". */
  interval?: string;
  timeframe?: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const modelName = ANALYSIS_MODELS.find((m) => m.id === modelId)?.name ?? "TradeMind Classic";
  const reviewFn = useServerFn(reviewPreScanAnswers);

  const [seed, setSeed] = useState(() => Date.now());
  const [facts, setFacts] = useState<ChartFacts | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Two questions about the instrument and levels actually on screen, plus one
  // about the confirmation this model requires. If the chart could not be read,
  // fall back to the model/shared bank so the checklist still appears.
  const questions = useMemo<PreScanQuestion[]>(() => {
    const model = pickPreScanQuestions(modelId, seed);
    if (!facts) return model;
    const chart = buildChartQuestions({
      facts,
      instrument: symbol ?? "this market",
      timeframe: timeframe ?? "this timeframe",
      seed,
    });
    return [...chart, model[0]].filter((q, i, arr) => arr.findIndex((x) => x.id === q.id) === i);
  }, [modelId, seed, facts, symbol, timeframe]);

  // Fresh questions each time the checklist opens, read from the live chart.
  useEffect(() => {
    if (!open) return;
    setSeed(Date.now());
    setChosen({});
    setRevealed(false);
    setFeedback(null);
    setLoading(false);
    setFacts(null);
    if (!ticker || !interval) return;
    let alive = true;
    setLoadingChart(true);
    fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=${encodeURIComponent(interval)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { bars?: PreScanBar[] } | null) => {
        if (alive) setFacts(readChartFacts(j?.bars));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoadingChart(false);
      });
    return () => {
      alive = false;
    };
  }, [open, ticker, interval]);

  const answeredAll = questions.every((q) => chosen[q.id] !== undefined);
  const score = questions.filter((q) => chosen[q.id] === q.correct).length;

  const submit = async () => {
    if (!answeredAll || loading) return;
    setRevealed(true);
    setLoading(true);
    try {
      const res = await reviewFn({
        data: {
          modelName,
          symbol,
          timeframe,
          answers: questions.map((q) => ({
            question: q.question,
            chosen: q.options[chosen[q.id]] ?? "",
            correct: q.options[q.correct],
            why: q.why,
            wasCorrect: chosen[q.id] === q.correct,
          })),
        },
      });
      setFeedback(res?.feedback ?? null);
    } catch {
      setFeedback(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-2xl rounded-sm p-0 overflow-hidden">
        <div className="border-b border-border/60 px-5 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <ClipboardCheck className="h-4 w-4 text-primary" />
              Confirmations first
            </DialogTitle>
            <DialogDescription className="text-xs">
              {loadingChart
                ? `Reading ${symbol ?? "the chart"}${timeframe ? ` on ${timeframe}` : ""}…`
                : revealed
                  ? `${score} of ${questions.length} correct. Read the answers, then run the scan.`
                  : `Answer these before ${modelName} scans${symbol ? ` ${symbol}` : ""}${timeframe ? ` on ${timeframe}` : ""}. Right or wrong, you get the answers after.`}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-5" aria-busy={loadingChart}>
          {/* Nothing is shown until the chart read finishes, otherwise the
              generic questions would be replaced by the chart-specific ones
              mid-answer and discard what the trader already picked. */}
          {loadingChart && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Reading {symbol ?? "the chart"}
              {timeframe ? ` on ${timeframe}` : ""}…
            </p>
          )}
          {!loadingChart && questions.map((q, qi) => {
            const pick = chosen[q.id];
            const right = pick === q.correct;
            return (
              <div key={q.id} className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{qi + 1}</span>
                  <p className="text-sm font-medium leading-snug">{q.question}</p>
                </div>
                <div className="space-y-1.5 pl-5">
                  {q.options.map((opt, oi) => {
                    const selected = pick === oi;
                    const showCorrect = revealed && oi === q.correct;
                    const showWrong = revealed && selected && oi !== q.correct;
                    return (
                      <button
                        key={oi}
                        type="button"
                        disabled={revealed}
                        onClick={() => setChosen((p) => ({ ...p, [q.id]: oi }))}
                        className={cn(
                          "w-full flex items-start gap-2 rounded-sm border px-3 py-2 text-left text-xs transition",
                          "border-border/60 hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent",
                          selected && !revealed && "border-primary/60 bg-primary/10",
                          showCorrect && "border-primary bg-primary/10 text-foreground",
                          showWrong && "border-destructive/60 bg-destructive/10",
                        )}
                      >
                        <span className="mt-[2px] h-3 w-3 shrink-0">
                          {showCorrect ? <Check className="h-3 w-3 text-primary" /> : null}
                          {showWrong ? <X className="h-3 w-3 text-destructive" /> : null}
                        </span>
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
                {revealed && (
                  <p className={cn("pl-5 text-xs", right ? "text-muted-foreground" : "text-foreground/90")}>
                    <span className="font-semibold">{right ? "Correct. " : "Right answer: "}</span>
                    {q.why}
                  </p>
                )}
              </div>
            );
          })}

          {revealed && (
            <div className="rounded-sm border border-border/60 bg-card/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Coach review
              </p>
              {loading ? (
                <p className="text-xs text-muted-foreground">Reading your answers…</p>
              ) : (
                <p className="text-xs leading-relaxed whitespace-pre-wrap">
                  {feedback ?? "Coach review is unavailable right now, but the answers above are the ones to learn."}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          {revealed ? (
            <Button size="sm" className="rounded-sm" onClick={onContinue} disabled={loading}>
              Run the scan
            </Button>
          ) : (
            <Button size="sm" className="rounded-sm" onClick={submit} disabled={loadingChart || !answeredAll}>
              {loadingChart ? "Reading the chart…" : answeredAll ? "Check my answers" : `Answer all ${questions.length}`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
