import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { getQuiz } from "@/lib/academy-quizzes";
import { findModule } from "@/lib/academy-content";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, Target, XCircle } from "lucide-react";

export const Route = createFileRoute("/_app/academy/review")({
  head: () => ({
    meta: [
      { title: "Review, Academy" },
      { name: "description", content: "Practice the quiz questions you missed. Correct answers clear from your review queue." },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { wrongBank, removeWrong, markStudiedToday } = useAcademyProgress();
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  const queue = useMemo(() => {
    return wrongBank
      .map((e) => {
        const questions = getQuiz(e.moduleId);
        const mod = findModule(e.moduleId);
        const q = questions?.[e.qIndex];
        if (!q || !mod) return null;
        return { entry: e, mod, question: q };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
  }, [wrongBank]);

  if (queue.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader
          title="Review"
          description="Questions you missed on module quizzes show up here. Answer them right to clear them out."
          icon={<Target className="h-6 w-6 text-primary" />}
        />
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-primary mx-auto mb-3" />
          <div className="font-semibold mb-1">Nothing to review</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Take a module quiz and any questions you miss will land here for later practice.
          </p>
          <Link
            to="/academy"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
          >
            Back to Academy <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  const clamped = Math.min(cursor, queue.length - 1);
  const current = queue[clamped];
  const q = current.question;
  const correct = picked === q.answer;

  function reveal() {
    if (picked === null) return;
    setRevealed(true);
    markStudiedToday();
    if (correct) {
      removeWrong(current.entry.moduleId, current.entry.qIndex);
    }
  }

  function next() {
    setPicked(null);
    setRevealed(false);
    setCursor((c) => (c + 1) % Math.max(1, queue.length));
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/academy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Academy
      </Link>

      <PageHeader
        title="Review"
        description={`${queue.length} question${queue.length === 1 ? "" : "s"} left in your review queue. Answer correctly to clear.`}
        icon={<Target className="h-6 w-6 text-primary" />}
      />

      <div className="rounded-md border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
          <span>
            Module {current.mod.id} · <span className="text-foreground/80">{current.mod.title}</span>
          </span>
          <span className="font-mono">{clamped + 1} / {queue.length}</span>
        </div>

        <div className="text-base sm:text-lg font-semibold mb-4">{q.q}</div>

        <div className="grid gap-2">
          {q.choices.map((c, j) => {
            const isPicked = picked === j;
            const isRight = q.answer === j;
            let cls = "border-border bg-background hover:border-primary/40";
            if (revealed) {
              if (isRight) cls = "border-primary bg-primary/10 text-foreground";
              else if (isPicked) cls = "border-destructive bg-destructive/10";
              else cls = "border-border bg-background opacity-60";
            } else if (isPicked) {
              cls = "border-primary bg-primary/5";
            }
            return (
              <button
                key={j}
                type="button"
                disabled={revealed}
                onClick={() => setPicked(j)}
                className={`text-left text-sm px-3 py-2.5 rounded-md border transition-colors ${cls}`}
              >
                {c}
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className={`mt-4 text-sm flex items-start gap-2 ${correct ? "text-primary" : "text-destructive"}`}>
            {correct ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <div>
              <div className="font-medium">
                {correct ? "Correct. Cleared from your review queue." : `Correct answer: ${q.choices[q.answer]}. Kept in queue for another pass.`}
              </div>
              {q.explain && <div className="text-muted-foreground mt-1">{q.explain}</div>}
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <Link
            to="/academy/$moduleId"
            params={{ moduleId: String(current.mod.id) }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Go to Module {current.mod.id}
          </Link>
          {!revealed ? (
            <button
              onClick={reveal}
              disabled={picked === null}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold bg-primary text-primary-foreground border border-primary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Check answer
            </button>
          ) : (
            <button
              onClick={next}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold border border-border bg-card"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Next question
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
