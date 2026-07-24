import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { ACADEMY, findLesson, type Lesson } from "@/lib/academy-content";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { GraduationCap, CheckCircle2, ArrowRight, PlayCircle, Flame, Target, Award } from "lucide-react";

export const Route = createFileRoute("/_app/academy")({
  head: () => ({
    meta: [
      { title: "Academy, TradeMind" },
      { name: "description", content: "Card-based trading lessons that build your understanding step by step." },
    ],
  }),
  component: AcademyIndex,
});

function AcademyIndex() {
  const {
    moduleCompletion,
    lastModule,
    lastLesson,
    quizScores,
    wrongBank,
    currentStreak,
    longestStreak,
    studiedToday,
  } = useAcademyProgress();

  const totalLessons = ACADEMY.reduce((n, m) => n + m.lessons.length, 0);
  const totalDone = ACADEMY.reduce((n, m) => n + moduleCompletion(m.lessons.map((l: Lesson) => l.id)).done, 0);
  const pct = Math.round((totalDone / totalLessons) * 100);

  const resume = lastModule && lastLesson ? findLesson(lastModule, lastLesson) : null;
  const reviewCount = wrongBank.length;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Academy"
        description="Card-based lessons that build your understanding step by step. Start at Module 1, or jump to whichever concept you need most."
        icon={<GraduationCap className="h-6 w-6 text-primary" />}
      />

      {/* Progress + Streak */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-semibold">Your progress</div>
              <div className="text-xs text-muted-foreground">{totalDone} of {totalLessons} lessons complete</div>
            </div>
            <div className="text-2xl font-semibold font-mono text-primary">{pct}%</div>
          </div>
          <div className="h-1.5 rounded-md bg-background overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1 text-sm font-semibold">
            <Flame className={`h-4 w-4 ${studiedToday ? "text-primary" : "text-muted-foreground"}`} />
            Study streak
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold font-mono">{currentStreak}</span>
            <span className="text-xs text-muted-foreground">day{currentStreak === 1 ? "" : "s"}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {studiedToday ? "Studied today." : "Do one lesson or quiz today to keep it going."} Longest: {longestStreak}.
          </div>
        </div>
      </div>

      {/* Resume + Review row */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        {resume ? (
          <Link
            to="/academy/$moduleId/$lessonId"
            params={{ moduleId: String(resume.mod.id), lessonId: resume.lesson.id }}
            className="group flex items-center gap-4 rounded-md border border-primary bg-card p-4"
          >
            <div className="h-10 w-10 rounded-md border border-border bg-background text-primary flex items-center justify-center shrink-0">
              <PlayCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest font-semibold text-primary">Resume where you left off</div>
              <div className="font-semibold text-sm truncate">
                Module {resume.mod.id}, Lesson {resume.index + 1}, {resume.lesson.title}
              </div>
              <div className="text-xs text-muted-foreground truncate">{resume.lesson.summary}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-primary shrink-0" />
          </Link>
        ) : (
          <Link
            to="/academy/$moduleId"
            params={{ moduleId: "1" }}
            className="group flex items-center gap-4 rounded-md border border-border bg-card p-4"
          >
            <div className="h-10 w-10 rounded-md border border-border bg-background text-primary flex items-center justify-center shrink-0">
              <PlayCircle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Start here</div>
              <div className="font-semibold text-sm truncate">Module 1, Reading the chart</div>
              <div className="text-xs text-muted-foreground truncate">The first lesson every trader should get right.</div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        )}

        <Link
          to="/academy/review"
          className="group flex items-center gap-4 rounded-md border border-border bg-card p-4"
        >
          <div className="h-10 w-10 rounded-md border border-border bg-background text-primary flex items-center justify-center shrink-0">
            <Target className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Practice missed questions</div>
            <div className="font-semibold text-sm truncate">
              {reviewCount === 0 ? "Nothing to review yet" : `${reviewCount} question${reviewCount === 1 ? "" : "s"} to review`}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {reviewCount === 0 ? "Take a module quiz to build your review queue." : "Answer correctly to clear from the queue."}
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      </div>

      {/* Module grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ACADEMY.map((m) => {
          const { done, total } = moduleCompletion(m.lessons.map((l: Lesson) => l.id));
          const pct = Math.round((done / total) * 100);
          const first3 = m.lessons.slice(0, 3).map((l: Lesson) => `${l.id} ${l.title}`);
          const rest = m.lessons.length - 3;
          const quiz = quizScores[String(m.id)];
          const certEligible = done === total && quiz && quiz.score / quiz.total >= 2 / 3;
          return (
            <div
              key={m.id}
              id={`module-${m.id}`}
              className="rounded-md border border-border bg-card p-4 flex flex-col"
            >
              <Link
                to="/academy/$moduleId"
                params={{ moduleId: String(m.id) }}
                className="flex items-center gap-3 mb-2 group"
              >
                <div
                  className="h-10 w-10 rounded-md border border-border flex items-center justify-center font-semibold text-lg bg-background"
                  style={{ color: m.accent }}
                >
                  {m.id}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Module {m.id}</div>
                  <div className="font-semibold truncate">{m.title}</div>
                </div>
              </Link>

              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{m.subtitle}</p>

              <div className="flex items-center justify-between text-[11px] mb-2">
                <span className="text-muted-foreground">{done}/{total} lessons</span>
                {done === total && (
                  <span className="inline-flex items-center gap-1 text-primary">
                    <CheckCircle2 className="h-3 w-3" /> Complete
                  </span>
                )}
              </div>
              <div className="h-1 rounded-md bg-background overflow-hidden mb-3">
                <div className="h-full transition-all bg-primary" style={{ width: `${pct}%` }} />
              </div>

              <div className="text-[11px] text-muted-foreground/90 line-clamp-2 mb-3">
                {first3.join(" · ")}{rest > 0 ? `  +${rest} more` : ""}
              </div>

              <div className="mt-auto flex items-center gap-3">
                <Link
                  to="/academy/$moduleId"
                  params={{ moduleId: String(m.id) }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                >
                  {done === 0 ? "Start module" : done === total ? "Review module" : "Continue"} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                {certEligible && (
                  <Link
                    to="/academy/certificate/$moduleId"
                    params={{ moduleId: String(m.id) }}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Award className="h-3.5 w-3.5" /> Certificate
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
