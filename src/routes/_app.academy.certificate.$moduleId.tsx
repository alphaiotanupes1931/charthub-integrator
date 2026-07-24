import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { findModule, type Lesson } from "@/lib/academy-content";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { useProfile } from "@/hooks/useProfile";
import { ArrowLeft, Printer, Award } from "lucide-react";

export const Route = createFileRoute("/_app/academy/certificate/$moduleId")({
  loader: ({ params }) => {
    const mod = findModule(Number(params.moduleId));
    if (!mod) throw notFound();
    return { mod };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `Certificate, ${loaderData.mod.title}` : "Certificate, Academy" },
      { name: "description", content: "TradeMind Academy certificate of completion." },
      { name: "robots", content: "noindex" },
    ],
  }),
  notFoundComponent: () => (
    <div className="max-w-3xl mx-auto py-12 text-center">
      <div className="text-lg font-semibold mb-2">Module not found</div>
      <Link to="/academy" className="text-primary text-sm">Back to Academy</Link>
    </div>
  ),
  component: CertificatePage,
});

function CertificatePage() {
  const { mod } = Route.useLoaderData();
  const { moduleCompletion, quizScores } = useAcademyProgress();
  const { profile } = useProfile();

  const { done, total } = moduleCompletion(mod.lessons.map((l) => l.id));
  const complete = done === total;
  const quiz = quizScores[String(mod.id)];
  const passed = quiz && quiz.score / quiz.total >= 2 / 3;
  const eligible = complete && passed;

  const name =
    (profile?.display_name && profile.display_name.trim()) ||
    (profile?.email ? profile.email.split("@")[0] : "TradeMind Trader");

  const issued = quiz?.at ? new Date(quiz.at) : new Date();
  const dateStr = issued.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  if (!eligible) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link to="/academy/$moduleId" params={{ moduleId: String(mod.id) }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Module {mod.id}
        </Link>
        <div className="rounded-md border border-border bg-card p-8 text-center">
          <Award className="h-8 w-8 text-primary mx-auto mb-3" />
          <div className="font-semibold mb-1">Not eligible yet</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Finish every lesson in Module {mod.id} and score at least 2 of 3 on the module quiz to unlock the certificate.
          </p>
          <div className="mt-4 text-xs text-muted-foreground">
            {done}/{total} lessons complete{quiz ? `, quiz best ${quiz.score}/${quiz.total}` : ", quiz not taken"}
          </div>
          <Link
            to="/academy/$moduleId"
            params={{ moduleId: String(mod.id) }}
            className="mt-5 inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
          >
            Continue module
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <Link to="/academy/$moduleId" params={{ moduleId: String(mod.id) }} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Module {mod.id}
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium"
        >
          <Printer className="h-3.5 w-3.5" /> Print / Save PDF
        </button>
      </div>

      <div className="rounded-md border border-border bg-card p-8 sm:p-14 text-center relative">
        <div className="absolute inset-4 border border-border rounded-sm pointer-events-none" />
        <div className="relative">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">TradeMind Academy</div>
          <div className="font-display text-2xl sm:text-3xl mt-1">Certificate of Completion</div>

          <div className="mt-10 text-sm text-muted-foreground">This certifies that</div>
          <div className="font-display text-3xl sm:text-5xl mt-2 tracking-tight">{name}</div>

          <div className="mt-8 text-sm text-muted-foreground">has completed</div>
          <div className="font-display text-xl sm:text-2xl mt-1">
            Module {mod.id}, {mod.title}
          </div>
          <p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">{mod.subtitle}</p>

          <div className="mt-12 grid grid-cols-3 gap-6 text-xs">
            <div>
              <div className="uppercase tracking-widest text-muted-foreground mb-1">Lessons</div>
              <div className="font-mono text-foreground">{done} / {total}</div>
            </div>
            <div>
              <div className="uppercase tracking-widest text-muted-foreground mb-1">Quiz</div>
              <div className="font-mono text-foreground">{quiz!.score} / {quiz!.total}</div>
            </div>
            <div>
              <div className="uppercase tracking-widest text-muted-foreground mb-1">Issued</div>
              <div className="font-mono text-foreground">{dateStr}</div>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-border text-[10px] uppercase tracking-widest text-muted-foreground">
            TradeMind, educational content, not financial advice
          </div>
        </div>
      </div>
    </div>
  );
}
