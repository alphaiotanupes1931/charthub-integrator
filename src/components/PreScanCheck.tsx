import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, ClipboardCheck, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PreScanQuestion } from "@/lib/prescan-questions";
import { buildChartQuestions, readChartFacts, type PreScanBar } from "@/lib/prescan-context";
import { reviewPreScanAnswers } from "@/lib/prescan-check.functions";
import { getNextPreScanQuestion, recordPreScanAnswer } from "@/lib/prescan-progress.functions";
import { LEVEL_LABEL, type Progress } from "@/lib/prescan-progress";
import { ANALYSIS_MODELS, type AnalysisModelId } from "@/lib/analysis-models";
import { cn } from "@/lib/utils";

/**
 * One flashcard question before each scan. The front shows the question and
 * choices; answering flips the card to show the right answer and the coach's
 * note. Questions answered correctly are never asked again for this trader,
 * and they move from Beginner to Intermediate to Advanced as they master each
 * level. Answers never change the scan itself.
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
  ticker?: string;
  interval?: string;
  timeframe?: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const modelName = ANALYSIS_MODELS.find((m) => m.id === modelId)?.name ?? "TradeMind Classic";
  const nextFn = useServerFn(getNextPreScanQuestion);
  const recordFn = useServerFn(recordPreScanAnswer);
  const reviewFn = useServerFn(reviewPreScanAnswers);

  const [question, setQuestion] = useState<PreScanQuestion | null>(null);
  const [fromBank, setFromBank] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadingQ, setLoadingQ] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loadingFb, setLoadingFb] = useState(false);
  const [levelUp, setLevelUp] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setQuestion(null);
    setPick(null);
    setFlipped(false);
    setFeedback(null);
    setLevelUp(null);
    setLoadingQ(true);
    (async () => {
      try {
        const res = await nextFn({ data: { modelId } });
        if (!alive) return;
        setProgress(res.progress);
        if (res.question) {
          setQuestion(res.question);
          setFromBank(true);
          return;
        }
        // Everything in the bank is mastered: ask about the live chart instead.
        if (ticker && interval) {
          const r = await fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=${encodeURIComponent(interval)}`);
          const j = r.ok ? ((await r.json()) as { bars?: PreScanBar[] }) : null;
          const facts = readChartFacts(j?.bars);
          if (alive && facts) {
            const qs = buildChartQuestions({ facts, instrument: symbol ?? "this market", timeframe: timeframe ?? "this timeframe", seed: Date.now() });
            setQuestion(qs[0] ?? null);
            setFromBank(false);
          }
        }
      } catch {
        /* no question: trader can still continue */
      } finally {
        if (alive) setLoadingQ(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, modelId, ticker, interval, symbol, timeframe, nextFn]);

  const answer = async (oi: number) => {
    if (!question || flipped) return;
    setPick(oi);
    setFlipped(true);
    setLoadingFb(true);
    const wasCorrect = oi === question.correct;
    if (fromBank) {
      recordFn({ data: { modelId, questionId: question.id, chosen: oi } })
        .then((r) => {
          if (r?.progress && progress && r.progress.level !== progress.level) {
            setLevelUp(LEVEL_LABEL[r.progress.level]);
          }
          if (r?.progress) setProgress(r.progress);
        })
        .catch(() => {});
    }
    try {
      const res = await reviewFn({
        data: {
          modelName,
          symbol,
          timeframe,
          answers: [{ question: question.question, chosen: question.options[oi], correct: question.options[question.correct], why: question.why, wasCorrect }],
        },
      });
      setFeedback(res?.feedback ?? null);
    } catch {
      setFeedback(null);
    } finally {
      setLoadingFb(false);
    }
  };

  const right = question && pick === question.correct;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-xl rounded-sm p-0 overflow-hidden">
        <div className="border-b border-border/60 px-5 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center justify-between gap-2 text-base font-semibold">
              <span className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                One question before the scan
              </span>
              {progress && (
                <span className="rounded-sm border border-primary/40 px-2 py-0.5 text-[10px] font-medium tracking-wide text-primary" data-testid="prescan-level">
                  {LEVEL_LABEL[progress.level]}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {progress
                ? `${progress.correctAtLevel} of ${progress.neededAtLevel} mastered at this level. Questions you get right are never asked again.`
                : `Answer before ${modelName} scans${symbol ? ` ${symbol}` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {progress && (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, (progress.correctAtLevel / Math.max(1, progress.neededAtLevel)) * 100)}%` }} />
            </div>
          )}
        </div>

        <div className="px-5 py-5">
          {loadingQ ? (
            <p className="py-16 text-center text-xs text-muted-foreground">Picking your question…</p>
          ) : !question ? (
            <p className="py-16 text-center text-xs text-muted-foreground">No question available right now. You can run the scan.</p>
          ) : (
            <div className="relative w-full" style={{ perspective: "1200px" }}>
              <div
                className="relative grid transition-transform duration-500"
                style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0)" }}
              >
                {/* Front: question */}
                <div className="col-start-1 row-start-1 rounded-sm border border-border/60 bg-card p-5" style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
                  <div className="mb-3 text-[10px] tracking-[0.2em] text-muted-foreground">QUESTION</div>
                  <p className="mb-4 text-base font-medium leading-snug">{question.question}</p>
                  <div className="space-y-1.5">
                    {question.options.map((opt, oi) => (
                      <button
                        key={oi}
                        type="button"
                        onClick={() => answer(oi)}
                        className="w-full rounded-sm border border-border/60 px-3 py-2 text-left text-sm transition hover:border-primary/60 hover:bg-primary/5"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Back: answer */}
                <div
                  className={cn("col-start-1 row-start-1 rounded-sm border p-5", right ? "border-primary/50 bg-primary/[0.06]" : "border-destructive/40 bg-destructive/[0.05]")}
                  style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <div className={cn("mb-3 flex items-center gap-1.5 text-[10px] tracking-[0.2em]", right ? "text-primary" : "text-destructive")}>
                    {right ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {right ? "CORRECT" : "NOT QUITE"}
                  </div>
                  <p className="mb-1 text-xs text-muted-foreground">{question.question}</p>
                  {!right && pick !== null && (
                    <p className="mb-2 text-xs text-muted-foreground line-through">{question.options[pick]}</p>
                  )}
                  <p className="mb-3 text-base font-medium leading-snug">{question.options[question.correct]}</p>
                  <p className="mb-3 text-sm leading-relaxed text-foreground/90">{question.why}</p>
                  <div className="border-t border-border/60 pt-3">
                    <p className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground">Coach</p>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {loadingFb ? "Reading your answer…" : feedback ?? "Learn the answer above, then run the scan."}
                    </p>
                  </div>
                  {levelUp && (
                    <p className="mt-3 rounded-sm border border-primary/50 px-3 py-2 text-xs font-medium text-primary">
                      You moved up to {levelUp}.
                    </p>
                  )}
                  {!right && fromBank && (
                    <p className="mt-3 text-[11px] text-muted-foreground">This one will come back later so you can get it right.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <Button size="sm" className="rounded-sm" onClick={onContinue} disabled={loadingQ || (!!question && !flipped)}>
            {question && !flipped ? "Answer to continue" : "Run the scan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
