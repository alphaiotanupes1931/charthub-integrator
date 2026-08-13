import { createFileRoute, Link, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { findLesson, type Lesson, type LessonBlock, type CalloutTone } from "@/lib/academy-content";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";
import { LessonChart } from "@/components/academy/LessonChart";
import {
  ArrowLeft, ArrowRight, CheckCircle2, Circle,
  Lightbulb, BarChart3, ListChecks, Sparkles, AlertTriangle, Compass,
} from "lucide-react";

export const Route = createFileRoute("/_app/academy/$moduleId/$lessonId")({
  loader: ({ params }) => {
    const found = findLesson(Number(params.moduleId), params.lessonId);
    if (!found) throw notFound();
    return found;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.lesson.id} ${loaderData.lesson.title}, Academy` : "Lesson, Academy" },
      { name: "description", content: loaderData?.lesson.summary ?? "Academy lesson" },
      { property: "og:title", content: loaderData ? `${loaderData.lesson.id} ${loaderData.lesson.title}, Academy` : "Lesson, Academy" },
      { property: "og:description", content: loaderData?.lesson.summary ?? "Academy lesson" },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: LessonError,
  notFoundComponent: LessonNotFound,
  component: LessonView,
});

const TONE_STYLES: Record<CalloutTone, { border: string; bg: string; text: string; icon: React.ComponentType<{ className?: string }> }> = {
  amber:   { border: "border-amber-500/40",   bg: "bg-amber-500/5",   text: "text-amber-400",   icon: Lightbulb },
  violet:  { border: "border-primary/40",     bg: "bg-primary/5",     text: "text-primary",     icon: BarChart3 },
  teal:    { border: "border-teal-500/40",    bg: "bg-teal-500/5",    text: "text-teal-400",    icon: Compass },
  rose:    { border: "border-rose-500/40",    bg: "bg-rose-500/5",    text: "text-rose-400",    icon: AlertTriangle },
  sky:     { border: "border-sky-500/40",     bg: "bg-sky-500/5",     text: "text-sky-400",     icon: Sparkles },
  emerald: { border: "border-emerald-500/40", bg: "bg-emerald-500/5", text: "text-emerald-400", icon: CheckCircle2 },
};

function LessonNotFound() {
  return (
    <div className="max-w-3xl mx-auto py-12 text-center">
      <div className="text-lg font-semibold mb-2">Lesson not found</div>
      <Link to="/academy" className="text-primary text-sm">Back to Academy</Link>
    </div>
  );
}

function LessonError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="max-w-3xl mx-auto py-12 text-center">
      <div className="text-lg font-semibold mb-2">Lesson did not load</div>
      <p className="text-sm text-muted-foreground mb-4">{error.message || "Open the lesson again."}</p>
      <div className="flex justify-center gap-2">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="rounded-xl border border-border/60 bg-card px-4 py-2 text-sm font-medium"
        >
          Try again
        </button>
        <Link to="/academy" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Back to Academy
        </Link>
      </div>
    </div>
  );
}

function LessonView() {
  const { mod, lesson, index, prev, next } = Route.useLoaderData();
  const { isDone, markDone, clear, setLastViewed } = useAcademyProgress();
  const navigate = useNavigate();
  const done = isDone(lesson.id);

  useEffect(() => {
    setLastViewed(mod.id, lesson.id);
  }, [mod.id, lesson.id, setLastViewed]);

  function completeAndAdvance() {
    markDone(lesson.id);
    emitFirstWeekEvent("academy-lesson", mod.id);
    if (next) {
      navigate({ to: "/academy/$moduleId/$lessonId", params: { moduleId: String(mod.id), lessonId: next.id } });
    } else {
      navigate({ to: "/academy/$moduleId", params: { moduleId: String(mod.id) } });
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <Link to="/academy" className="hover:text-foreground">Academy</Link>
        <span>/</span>
        <Link to="/academy/$moduleId" params={{ moduleId: String(mod.id) }} className="hover:text-foreground truncate">
          M{mod.id} · {mod.title}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] tracking-tight font-semibold" style={{ color: mod.accent }}>
            Lesson {index + 1} of {mod.lessons.length}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">· {lesson.id}</span>
          <span className="text-[10px] text-muted-foreground">· {lesson.minutes} min read</span>
        </div>
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight">{lesson.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{lesson.summary}</p>
      </div>

      <div className="mb-6 rounded-xl border border-border/60 bg-card p-3">
        <div className="mb-3 flex items-center justify-between gap-3 text-xs">
          <span className="font-semibold">Module lessons</span>
          <span className="font-mono text-muted-foreground">{index + 1}/{mod.lessons.length}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {mod.lessons.map((item: Lesson, itemIndex: number) => {
            const current = item.id === lesson.id;
            const itemDone = isDone(item.id);
            return (
              <Link
                key={item.id}
                to="/academy/$moduleId/$lessonId"
                params={{ moduleId: String(mod.id), lessonId: item.id }}
                aria-current={current ? "page" : undefined}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                  current ? "border-primary bg-primary/10 text-foreground" : "border-border/60 bg-background hover:border-primary/40"
                }`}
              >
                {itemDone ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="font-mono text-muted-foreground">{itemIndex + 1}</span>
                <span className="truncate">{item.title}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Blocks */}
      <div className="space-y-5">
        {lesson.blocks.map((block: LessonBlock, i: number) => <BlockRenderer key={i} block={block} />)}
      </div>

      {/* Completion + navigation */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5">
        <div className="flex items-center gap-2">
          {prev ? (
            <Link
              to="/academy/$moduleId/$lessonId"
              params={{ moduleId: String(mod.id), lessonId: prev.id }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/60 bg-card hover:border-primary/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Previous
            </Link>
          ) : (
            <Link
              to="/academy/$moduleId"
              params={{ moduleId: String(mod.id) }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-border/60 bg-card hover:border-primary/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Module
            </Link>
          )}
          <button
            onClick={() => done ? clear(lesson.id) : markDone(lesson.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition ${
              done
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            {done ? "Completed" : "Mark complete"}
          </button>
        </div>

        <button
          onClick={completeAndAdvance}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {next ? "Next lesson" : "Finish module"} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function BlockRenderer({ block }: { block: LessonBlock }) {
  switch (block.kind) {
    case "intro":
      return <p className="text-[15px] leading-relaxed text-foreground/90">{block.text}</p>;

    case "list":
      return (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
          {block.lead && <p className="text-[15px] leading-relaxed mb-3">{block.lead}</p>}
          <ul className="space-y-2">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case "callout": {
      const t = TONE_STYLES[block.tone];
      const Icon = t.icon;
      return (
        <div className={`rounded-xl border ${t.border} ${t.bg} p-4 sm:p-5`}>
          <div className={`flex items-center gap-2 mb-3 ${t.text}`}>
            <div className={`h-6 w-6 rounded-full ${t.bg} border ${t.border} flex items-center justify-center`}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <span className="text-[10px] tracking-[0.18em] font-bold">{block.label}</span>
          </div>
          {block.title && <div className="font-semibold text-lg mb-2">{block.title}</div>}
          <p className="text-[15px] leading-relaxed text-foreground/90 whitespace-pre-line">{block.body}</p>
          {block.chart && (
            <div className="mt-4">
              <LessonChart type={block.chart} />
              {block.caption && <p className="mt-2 text-xs text-muted-foreground italic leading-relaxed">{block.caption}</p>}
            </div>
          )}
        </div>
      );
    }

    case "chart":
      return (
        <div>
          <LessonChart type={block.chart} />
          {block.caption && <p className="mt-2 text-xs text-muted-foreground italic leading-relaxed">{block.caption}</p>}
        </div>
      );

    case "steps":
      return (
        <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3 text-primary">
            <ListChecks className="h-4 w-4" />
            <span className="text-[10px] tracking-[0.18em] font-bold">{block.title}</span>
          </div>
          <ol className="space-y-2">
            {block.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      );

    case "takeaway":
      return (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="text-[10px] tracking-[0.18em] font-bold">Key Takeaway</span>
          </div>
          <p className="text-[15px] leading-relaxed font-medium">{block.body}</p>
        </div>
      );
  }
}
