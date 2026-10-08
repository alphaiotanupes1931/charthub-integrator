import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { QUESTIONS, PROBLEMS, QUICK_KEYS, type Answers, type AnswerKey } from "@/lib/trader-profile/config";
import { answersFromProblem } from "@/lib/trader-profile/score";

type Props = {
  mode: "public" | "onboarding";
  onComplete: (answers: Answers, source: "public_quiz" | "onboarding" | "self_select") => void;
  onAnswer?: (key: string, index: number) => void;
  onStart?: (path: "full" | "quick") => void;
};

const QUICK_QS = QUESTIONS.filter((q) => QUICK_KEYS.includes(q.key));

export function TraderProfileFlow({ mode, onComplete, onAnswer, onStart }: Props) {
  const [path, setPath] = useState<"full" | "quick" | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [problem, setProblem] = useState<string | null>(null);
  const lock = useRef(false);

  const total = path === "quick" ? 1 + QUICK_QS.length : QUESTIONS.length;

  function advance(fn: () => void) {
    if (lock.current) return; // guard against double-tap skipping
    lock.current = true;
    fn();
    setTimeout(() => { lock.current = false; }, 280);
  }

  function pick(key: AnswerKey, value: string) {
    advance(() => {
      const next = { ...answers, [key]: value };
      setAnswers(next);
      onAnswer?.(key, idx);
      const list = path === "quick" ? QUICK_QS : QUESTIONS;
      const pos = path === "quick" ? idx - 1 : idx;
      if (pos + 1 >= list.length) {
        if (path === "quick") onComplete(answersFromProblem(problem ?? "", next), "self_select");
        else onComplete(next, mode === "public" ? "public_quiz" : "onboarding");
      } else setIdx(idx + 1);
    });
  }

  if (!path) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "public" ? "What's your trader type?" : "Find your trader type"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {mode === "public"
            ? "Sixty seconds. One tap per question. Find out what's really costing you money."
            : "A few quick questions so we can set up your coach, strategy, risk and first week."}
        </p>
        <button onClick={() => { setPath("full"); onStart?.("full"); }}
          className="w-full rounded-xl border border-primary/50 bg-primary/10 p-4 text-left hover:bg-primary/15 transition">
          <div className="font-semibold">Help me figure out my type</div>
          <div className="text-xs text-muted-foreground mt-0.5">{QUESTIONS.length} quick questions</div>
        </button>
        <button onClick={() => { setPath("quick"); onStart?.("quick"); }}
          className="w-full rounded-xl border border-border/60 bg-card p-4 text-left hover:border-primary/40 transition">
          <div className="font-semibold">I already know my problem</div>
          <div className="text-xs text-muted-foreground mt-0.5">Pick it directly. 3 screens.</div>
        </button>
      </div>
    );
  }

  const back = () => advance(() => { if (idx === 0) setPath(null); else setIdx(idx - 1); });
  const pct = Math.round((idx / total) * 100);

  let body: React.ReactNode;
  if (path === "quick" && idx === 0) {
    body = (
      <Screen prompt="What's the problem?">
        {PROBLEMS.map((p) => (
          <OptionBtn key={p.value} active={problem === p.value} label={p.label}
            onClick={() => advance(() => { setProblem(p.value); onAnswer?.("problem", 0); setIdx(1); })} />
        ))}
      </Screen>
    );
  } else {
    const q = path === "quick" ? QUICK_QS[idx - 1] : QUESTIONS[idx];
    const scale = q.key === "anxiety";
    body = (
      <Screen prompt={q.prompt}>
        <div className={scale ? "grid grid-cols-5 gap-2" : "space-y-2"}>
          {q.options.map((o) => (
            <OptionBtn key={o.value} active={answers[q.key] === o.value} label={o.label} compact={scale}
              onClick={() => pick(q.key, o.value)} />
          ))}
        </div>
        {scale && <div className="flex justify-between text-[11px] text-muted-foreground mt-1"><span>Calm</span><span>Very anxious</span></div>}
      </Screen>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={back} aria-label="Back" className="h-8 w-8 rounded-lg border border-border/60 flex items-center justify-center hover:border-primary/40">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{idx + 1}/{total}</span>
      </div>
      {body}
    </div>
  );
}

function Screen({ prompt, children }: { prompt: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold leading-snug">{prompt}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function OptionBtn({ label, active, onClick, compact }: { label: string; active: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full rounded-xl border text-sm font-medium transition flex items-center justify-between ${compact ? "h-11 justify-center px-0" : "min-h-12 px-4 py-3 text-left"} ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-card hover:border-primary/40"}`}>
      <span>{label}</span>
      {!compact && <ArrowRight className="h-3.5 w-3.5 opacity-40" />}
    </button>
  );
}
