import { createFileRoute, Link } from "@tanstack/react-router";
import { ACADEMY, type Lesson } from "@/lib/academy-content";
import { useAcademyProgress } from "@/hooks/useAcademyProgress";
import { useProfile } from "@/hooks/useProfile";
import { ArrowLeft, Award, Printer } from "lucide-react";

export const Route = createFileRoute("/_app/academy/master-certificate")({
  head: () => ({
    meta: [
      { title: "Master Certificate, Academy" },
      { name: "description", content: "TradeMind Academy master certificate of completion." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MasterCertificatePage,
});

function MasterCertificatePage() {
  const { moduleCompletion, finalExam } = useAcademyProgress();
  const { profile } = useProfile();

  const allComplete = ACADEMY.every((m) => {
    const { done, total } = moduleCompletion(m.lessons.map((l: Lesson) => l.id));
    return done === total && total > 0;
  });
  const passed = finalExam && finalExam.score / finalExam.total >= 0.8;
  const eligible = allComplete && passed;

  const name =
    (profile?.display_name && profile.display_name.trim()) ||
    (profile?.email ? profile.email.split("@")[0] : "TradeMind Trader");

  const issued = finalExam?.at ? new Date(finalExam.at) : new Date();
  const dateStr = issued.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  if (!eligible) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link to="/academy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Academy
        </Link>
        <div className="rounded-xl border border-border/60 bg-card p-8 text-center">
          <Award className="h-8 w-8 text-primary mx-auto mb-3" />
          <div className="font-semibold mb-1">Not eligible yet</div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Finish every lesson in all 12 modules and pass the final exam with at least 80% to earn the master certificate.
          </p>
          <Link
            to="/academy/exam"
            className="mt-5 inline-flex items-center rounded-xl border border-border/60 bg-background px-4 py-2 text-sm font-medium"
          >
            Go to final exam
          </Link>
        </div>
      </div>
    );
  }

  const pct = Math.round((finalExam!.score / finalExam!.total) * 100);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4 print:hidden">
        <Link to="/academy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Academy
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs font-medium"
        >
          <Printer className="h-3.5 w-3.5" /> Print / Save PDF
        </button>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-8 sm:p-14 text-center relative">
        <div className="absolute inset-4 border border-border/60 rounded-lg pointer-events-none" />
        <div className="relative">
          <div className="text-[10px] tracking-tight text-muted-foreground font-semibold">TradeMind Academy</div>
          <div className="font-display text-2xl sm:text-3xl mt-1">Master Certificate</div>

          <div className="mt-10 text-sm text-muted-foreground">This certifies that</div>
          <div className="font-display text-3xl sm:text-5xl mt-2 tracking-tight">{name}</div>

          <div className="mt-8 text-sm text-muted-foreground">has completed the full TradeMind Academy curriculum,</div>
          <div className="font-display text-xl sm:text-2xl mt-1">
            12 modules and the comprehensive final exam
          </div>

          <div className="mt-12 grid grid-cols-3 gap-6 text-xs">
            <div>
              <div className="tracking-tight text-muted-foreground mb-1">Modules</div>
              <div className="font-mono text-foreground">{ACADEMY.length} / {ACADEMY.length}</div>
            </div>
            <div>
              <div className="tracking-tight text-muted-foreground mb-1">Final exam</div>
              <div className="font-mono text-foreground">{finalExam!.score} / {finalExam!.total} ({pct}%)</div>
            </div>
            <div>
              <div className="tracking-tight text-muted-foreground mb-1">Issued</div>
              <div className="font-mono text-foreground">{dateStr}</div>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-border/60 text-[10px] tracking-tight text-muted-foreground">
            TradeMind, educational content, not financial advice
          </div>
        </div>
      </div>
    </div>
  );
}
