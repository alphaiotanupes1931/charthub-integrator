import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import type { QuizQuestion } from "@/lib/academy-quizzes";

/** One question right after the lesson. Must be answered correctly to move on. */
export function LessonCheck({
  question, accent, onPassed, alreadyPassed,
}: { question: QuizQuestion; accent: string; onPassed: () => void; alreadyPassed: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [passed, setPassed] = useState(alreadyPassed);

  useEffect(() => { setPicked(null); setPassed(alreadyPassed); }, [question, alreadyPassed]);

  function choose(j: number) {
    if (passed) return;
    setPicked(j);
    if (j === question.answer) { setPassed(true); onPassed(); }
  }

  const wrong = picked !== null && picked !== question.answer;

  return (
    <div className="mt-8 rounded-xl border-2 p-4 sm:p-5 bg-card" style={{ borderColor: passed ? undefined : accent }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: accent }}>
        <HelpCircle className="h-4 w-4" />
        <span className="text-[11px] font-semibold">Check your understanding</span>
      </div>
      <div className="text-base font-semibold mb-3">{question.q}</div>
      <div className="grid gap-2">
        {question.choices.map((c, j) => {
          let cls = "border-border/60 bg-background hover:border-primary/50";
          if (passed && j === question.answer) cls = "border-emerald-500/60 bg-emerald-500/10 text-emerald-300";
          else if (wrong && j === picked) cls = "border-rose-500/60 bg-rose-500/10 text-rose-300";
          return (
            <button key={j} type="button" disabled={passed} onClick={() => choose(j)}
              className={`text-left text-sm px-3 py-2.5 rounded-md border transition ${cls}`}>
              {c}
            </button>
          );
        })}
      </div>
      {wrong && !passed && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-rose-400">
          <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Not quite. Re-read the lesson above and try another answer.</span>
        </div>
      )}
      {passed && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Correct. You can move on.
            {question.explain && <span className="text-muted-foreground"> {question.explain}</span>}
          </span>
        </div>
      )}
    </div>
  );
}
