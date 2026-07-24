import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { QUIZZES, type QuizQuestion } from "@/lib/academy-quizzes";
import { ACADEMY, type Lesson } from "@/lib/academy-content";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { ArrowLeft, Award, CheckCircle2, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

type ExamItem = { moduleId: number; qIndex: number; q: QuizQuestion };

function buildExam(): ExamItem[] {
  const items: ExamItem[] = [];
  for (const modId of Object.keys(QUIZZES).map(Number).sort((a, b) => a - b)) {
    const qs = QUIZZES[modId];
    qs.forEach((q, qIndex) => items.push({ moduleId: modId, qIndex, q }));
  }
  return items;
}

export const Route = createFileRoute("/_app/academy/exam")({
  head: () => ({
    meta: [
      { title: "Final Exam, Academy" },
      { name: "description", content: "Comprehensive final exam covering every Academy module. Score 80% to earn the master certificate." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FinalExamPage,
});

function FinalExamPage() {
  const { moduleCompletion, recordFinalExam, finalExam, markStudiedToday } = useAcademyProgress();
  const exam = useMemo(buildExam, []);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  // Eligibility: every module complete
  const allComplete = ACADEMY.every((m) => {
    const { done, total } = moduleCompletion(m.lessons.map((l: Lesson) => l.id));
    return done === total && total > 0;
  });

  const answered = Object.keys(answers).length;
  const score = exam.reduce((n, item, i) => n + (answers[i] === item.q.answer ? 1 : 0), 0);
  const pct = submitted ? Math.round((score / exam.length) * 100) : 0;
  const passed = submitted && score / exam.length >= 0.8;

  function submit() {
    if (answered !== exam.length) return;
    setSubmitted(true);
    recordFinalExam(score, exam.length);
    markStudiedToday();
    if (score / exam.length >= 0.8) emitFirstWeekEvent("final-exam");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setAnswers({});
    setSubmitted(false);
  }

  if (!allComplete) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link to="/academy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Academy
        </Link>
        <PageHeader
          title="Final Exam"
          description="A comprehensive test across all 12 modules. Unlocks after every lesson is complete."
          icon={<Sparkles className="h-6 w-6 text-primary" />}
        />
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <Award className="h-8 w-8 text-primary mx-auto mb-3" />
          <div className="font-semibold mb-1">Locked</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Finish every lesson in all 12 modules to unlock the final exam. Pass with 80% or higher to earn the master certificate.
          </p>
          <Link
            to="/academy"
            className="mt-5 inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
          >
            Continue learning
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/academy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Academy
      </Link>

      <PageHeader
        title="Final Exam"
        description={`${exam.length} questions spanning every module. Score at least 80% to unlock the master certificate.`}
        icon={<Sparkles className="h-6 w-6 text-primary" />}
      />

      {finalExam && !submitted && (
        <div className="mb-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
          Best attempt so far: <span className="font-mono text-foreground">{finalExam.score}/{finalExam.total}</span> ({Math.round(finalExam.score / finalExam.total * 100)}%).
        </div>
      )}

      {submitted && (
        <div className={`mb-5 rounded-md border p-5 ${passed ? "border-primary bg-primary/10" : "border-destructive/40 bg-destructive/5"}`}>
          <div className="flex items-center gap-2 mb-1">
            {passed
              ? <CheckCircle2 className="h-5 w-5 text-primary" />
              : <XCircle className="h-5 w-5 text-destructive" />}
            <div className="font-semibold">
              {passed ? "You passed" : "Not quite there"}
            </div>
          </div>
          <div className="text-sm">
            You scored <span className="font-mono font-semibold">{score}/{exam.length}</span> ({pct}%). Passing mark is 80%.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {passed && (
              <Link
                to="/academy/master-certificate"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold bg-primary text-primary-foreground"
              >
                <Award className="h-4 w-4" /> View master certificate
              </Link>
            )}
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium border border-border bg-card"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retake exam
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {exam.map((item, i) => {
          const picked = answers[i];
          const correct = picked === item.q.answer;
          return (
            <div key={`${item.moduleId}-${item.qIndex}`} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
                <span>Question {i + 1} of {exam.length}</span>
                <span>Module {item.moduleId}</span>
              </div>
              <div className="text-sm font-medium mb-3">{item.q.q}</div>
              <div className="grid gap-1.5">
                {item.q.choices.map((c, j) => {
                  const isPicked = picked === j;
                  const isRight = item.q.answer === j;
                  let cls = "border-border bg-background hover:border-primary/40";
                  if (submitted) {
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
                      disabled={submitted}
                      onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                      className={`text-left text-sm px-3 py-2 rounded-md border transition ${cls}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              {submitted && !correct && (
                <div className="mt-2 text-xs text-destructive">
                  Correct answer: {item.q.choices[item.q.answer]}.
                  {item.q.explain && <span className="text-muted-foreground"> {item.q.explain}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!submitted && (
        <div className="sticky bottom-4 mt-6 flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">
            Answered <span className="font-mono text-foreground">{answered}/{exam.length}</span>
          </div>
          <button
            onClick={submit}
            disabled={answered !== exam.length}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Submit exam
          </button>
        </div>
      )}
    </div>
  );
}
