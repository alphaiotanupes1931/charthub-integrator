import { useState } from "react";
import { getQuiz, type QuizQuestion } from "@/lib/academy-quizzes";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { CheckCircle2, XCircle, HelpCircle, RotateCcw } from "lucide-react";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

export function ModuleQuiz({ moduleId, accent }: { moduleId: number; accent: string }) {
  const questions = getQuiz(moduleId);
  const { quizScores, recordQuiz, addWrong, removeWrong } = useAcademyProgress();
  const prior = quizScores[String(moduleId)];
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  if (!questions || questions.length === 0) return null;

  function submit() {
    let score = 0;
    questions!.forEach((q, i) => {
      const correct = answers[i] === q.answer;
      if (correct) { score++; removeWrong(moduleId, i); }
      else { addWrong(moduleId, i); }
    });
    setSubmitted(true);
    recordQuiz(moduleId, score, questions!.length);
    if (score / questions!.length >= 2 / 3) emitFirstWeekEvent("quiz-pass");
  }


  function reset() {
    setAnswers({});
    setSubmitted(false);
  }

  const score = questions.reduce((n, q, i) => n + (answers[i] === q.answer ? 1 : 0), 0);
  const allAnswered = Object.keys(answers).length === questions.length;

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1" style={{ color: accent }}>
        <HelpCircle className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-[0.18em] font-bold">Quick review</span>
      </div>
      <div className="font-semibold text-base mb-1">Module {moduleId} quiz</div>
      <p className="text-xs text-muted-foreground mb-4">
        Three quick questions to lock in the ideas. Your score is saved but doesn't gate anything.
        {prior && (
          <> Best so far: <span className="font-mono">{prior.score}/{prior.total}</span>.</>
        )}
      </p>

      <div className="space-y-4">
        {questions.map((q: QuizQuestion, i: number) => {
          const picked = answers[i];
          const correct = picked === q.answer;
          return (
            <div key={i} className="rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="text-sm font-medium mb-2">{i + 1}. {q.q}</div>
              <div className="grid gap-1.5">
                {q.choices.map((c, j) => {
                  const isPicked = picked === j;
                  const isRight = q.answer === j;
                  let cls = "border-border/60 bg-card hover:border-primary/40";
                  if (submitted) {
                    if (isRight) cls = "border-emerald-500/50 bg-emerald-500/10 text-emerald-300";
                    else if (isPicked) cls = "border-rose-500/50 bg-rose-500/10 text-rose-300";
                    else cls = "border-border/40 bg-card/60 opacity-70";
                  } else if (isPicked) {
                    cls = "border-primary/60 bg-primary/10";
                  }
                  return (
                    <button
                      key={j}
                      type="button"
                      disabled={submitted}
                      onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                      className={`text-left text-sm px-3 py-2 rounded-md border transition ${cls}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              {submitted && (
                <div className={`mt-2 text-xs flex items-start gap-1.5 ${correct ? "text-emerald-400" : "text-rose-400"}`}>
                  {correct ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5" /> : <XCircle className="h-3.5 w-3.5 mt-0.5" />}
                  <span>
                    {correct ? "Correct." : `Correct answer: ${q.choices[q.answer]}.`}
                    {q.explain && <span className="text-muted-foreground"> {q.explain}</span>}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-xs">
          {submitted ? (
            <span>You scored <span className="font-mono font-bold" style={{ color: accent }}>{score}/{questions.length}</span></span>
          ) : (
            <span className="text-muted-foreground">Answer all {questions.length} to grade.</span>
          )}
        </div>
        {submitted ? (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-border bg-card hover:border-primary/40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!allAnswered}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Grade quiz
          </button>
        )}
      </div>
    </div>
  );
}
