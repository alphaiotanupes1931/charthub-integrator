import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { findModule } from "@/lib/academy-content";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { ArrowLeft, CheckCircle2, Circle, Clock } from "lucide-react";

export const Route = createFileRoute("/_app/academy/$moduleId")({
  loader: ({ params }) => {
    const mod = findModule(Number(params.moduleId));
    if (!mod) throw notFound();
    return { mod };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.mod.title}, Academy` : "Module, Academy" },
      { name: "description", content: loaderData?.mod.subtitle ?? "Trading Academy module" },
    ],
  }),
  notFoundComponent: () => (
    <div className="max-w-3xl mx-auto py-12 text-center">
      <div className="text-lg font-semibold mb-2">Module not found</div>
      <Link to="/academy" className="text-primary text-sm">Back to Academy</Link>
    </div>
  ),
  component: ModuleDetail,
});

function ModuleDetail() {
  const { mod } = Route.useLoaderData();
  const { isDone, moduleCompletion } = useAcademyProgress();
  const { done, total } = moduleCompletion(mod.lessons.map((l) => l.id));
  const pct = Math.round((done / total) * 100);

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/academy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Academy
      </Link>

      <div className="flex items-center gap-4 mb-2">
        <div
          className="h-14 w-14 rounded-xl flex items-center justify-center font-bold text-2xl"
          style={{ background: `${mod.accent}22`, color: mod.accent }}
        >
          {mod.id}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Module {mod.id}</div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">{mod.title}</h1>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-5 ml-[4.5rem]">{mod.subtitle}</p>

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="font-semibold">{done}/{total} lessons complete</span>
          <span className="font-mono text-primary">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-background overflow-hidden">
          <div className="h-full transition-all" style={{ width: `${pct}%`, background: mod.accent }} />
        </div>
      </div>

      <div className="space-y-2">
        {mod.lessons.map((lesson, i) => {
          const done = isDone(lesson.id);
          return (
            <Link
              key={lesson.id}
              to="/academy/$moduleId/$lessonId"
              params={{ moduleId: String(mod.id), lessonId: lesson.id }}
              className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 sm:p-4 hover:border-primary/40 transition"
            >
              <div className="mt-0.5">
                {done
                  ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  : <Circle className="h-5 w-5 text-muted-foreground/40" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground">{lesson.id}</span>
                  <span className="text-xs text-muted-foreground/60">·</span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Lesson {i + 1}</span>
                </div>
                <div className="font-semibold text-sm truncate">{lesson.title}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{lesson.summary}</div>
              </div>
              <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
                <Clock className="h-3 w-3" /> {lesson.minutes}m
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
