import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { ACADEMY, findLesson } from "@/lib/academy-content";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { GraduationCap, CheckCircle2, ArrowRight, PlayCircle } from "lucide-react";

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
  const { moduleCompletion, lastModule, lastLesson } = useAcademyProgress();

  const totalLessons = ACADEMY.reduce((n, m) => n + m.lessons.length, 0);
  const totalDone = ACADEMY.reduce((n, m) => n + moduleCompletion(m.lessons.map((l) => l.id)).done, 0);
  const pct = Math.round((totalDone / totalLessons) * 100);

  const resume = lastModule && lastLesson ? findLesson(lastModule, lastLesson) : null;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Academy"
        description="Card-based lessons that build your understanding step by step. Start at Module 1, or jump to whichever concept you need most."
        icon={<GraduationCap className="h-6 w-6 text-primary" />}
      />

      {/* Overall progress */}
      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-semibold">Your progress</div>
            <div className="text-xs text-muted-foreground">{totalDone} of {totalLessons} lessons complete</div>
          </div>
          <div className="text-2xl font-bold font-mono text-primary">{pct}%</div>
        </div>
        <div className="h-2 rounded-full bg-background overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>


      {/* Resume where you left off */}
      {resume && (
        <Link
          to="/academy/$moduleId/$lessonId"
          params={{ moduleId: String(resume.mod.id), lessonId: resume.lesson.id }}
          className="mb-6 group flex items-center gap-4 rounded-xl border border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 transition p-4"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <PlayCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-primary">Resume where you left off</div>
            <div className="font-semibold text-sm truncate">
              M{resume.mod.id}, Lesson {resume.index + 1}, {resume.lesson.title}
            </div>
            <div className="text-xs text-muted-foreground truncate">{resume.lesson.summary}</div>
          </div>
          <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}

      {/* Module grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

        {ACADEMY.map((m) => {
          const { done, total } = moduleCompletion(m.lessons.map((l) => l.id));
          const pct = Math.round((done / total) * 100);
          const first3 = m.lessons.slice(0, 3).map((l) => `${l.id} ${l.title}`);
          const rest = m.lessons.length - 3;
          return (
            <Link
              key={m.id}
              id={`module-${m.id}`}
              to="/academy/$moduleId"
              params={{ moduleId: String(m.id) }}
              className="group rounded-xl border border-border bg-card hover:border-primary/40 transition p-4 flex flex-col"
              style={{ boxShadow: `inset 0 1px 0 0 ${m.accent}22` }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center font-bold text-lg"
                  style={{ background: `${m.accent}22`, color: m.accent }}
                >
                  {m.id}
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Module {m.id}</div>
                  <div className="font-semibold truncate">{m.title}</div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed mb-3">{m.subtitle}</p>

              <div className="flex items-center justify-between text-[11px] mb-2">
                <span className="text-muted-foreground">{done}/{total} lessons</span>
                {done === total && <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Complete</span>}
              </div>
              <div className="h-1.5 rounded-full bg-background overflow-hidden mb-3">
                <div className="h-full transition-all" style={{ width: `${pct}%`, background: m.accent }} />
              </div>

              <div className="text-[11px] text-muted-foreground/90 line-clamp-2 mb-3">
                {first3.join("  ·  ")}{rest > 0 ? `  +${rest} more` : ""}
              </div>

              <div className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-2 transition-all">
                Start module <ArrowRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
