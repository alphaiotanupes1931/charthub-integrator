import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { RotateCcw } from "lucide-react";
import type { AnalystNote, AnalystRole } from "@/lib/agents/types";

// The scan's five desk members. Four analysts each give a view; the head
// trader weighs them and makes the call (the final grade).
type MemberId = AnalystRole | "head";

export const DESK: Array<{ id: MemberId; name: string; role: string; tone: string }> = [
  { id: "technical", name: "Chart", role: "Structure, levels, entries", tone: "text-primary" },
  { id: "macro", name: "Macro", role: "News, rates, sessions", tone: "text-gold" },
  { id: "head", name: "Head Trader", role: "Makes the final call", tone: "text-foreground" },
  { id: "sentiment", name: "Crowd", role: "Positioning and mood", tone: "text-agent-violet" },
  { id: "risk", name: "Risk", role: "Volatility and stop size", tone: "text-agent-sky" },
];

function Accessory({ id }: { id: MemberId }) {
  switch (id) {
    case "technical": // glasses
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="15" cy="15" r="3.2" /><circle cx="25" cy="15" r="3.2" /><path d="M18.2 15h3.6" />
        </g>
      );
    case "macro": // globe badge
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="20" cy="38" r="4.5" /><path d="M15.5 38h9M20 33.5c-2.4 2.6-2.4 6.4 0 9M20 33.5c2.4 2.6 2.4 6.4 0 9" />
        </g>
      );
    case "sentiment": // speech lines
      return (
        <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M16 36.5h8M16 40h5" />
        </g>
      );
    case "risk": // shield
      return <path d="M20 33l5 2v3.5c0 3-2.2 5-5 6-2.8-1-5-3-5-6V35z" fill="none" stroke="currentColor" strokeWidth="1.4" />;
    case "head": // tie
      return <path d="M20 30l2 2.5-1.2 9L20 43l-.8-1.5-1.2-9z" fill="currentColor" />;
  }
}

/** Simple geometric figure: head, shoulders, and one role accessory. */
function Figure({ id, tone, size = 44 }: { id: MemberId; tone: string; size?: number }) {
  return (
    <svg viewBox="0 0 40 48" width={size} height={size * 1.2} className={tone} aria-hidden>
      <path d="M5 48c0-11 6.5-18 15-18s15 7 15 18z" fill="currentColor" opacity="0.18" />
      <path d="M5 48c0-11 6.5-18 15-18s15 7 15 18" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="20" cy="15" r="9" fill="currentColor" opacity="0.18" />
      <circle cx="20" cy="15" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <Accessory id={id} />
    </svg>
  );
}

const biasWord = (b?: string) => (b === "bullish" ? "Bullish" : b === "bearish" ? "Bearish" : "Neutral");
const biasTone = (b?: string) => (b === "bullish" ? "text-bull" : b === "bearish" ? "text-bear" : "text-muted-foreground");

export function TradingDesk({
  notes, grade, bias, verdict, playKey,
}: {
  notes: AnalystNote[];
  grade: string;
  bias: string;
  verdict?: string;
  /** Changes on each new scan so the meeting replays. */
  playKey: string;
}) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? 99 : 0);
  const [run, setRun] = useState(0);
  const order: MemberId[] = ["technical", "macro", "sentiment", "risk", "head"];
  const speaking = step >= 1 && step <= order.length ? order[step - 1] : null;

  useEffect(() => {
    if (reduce) { setStep(99); return; }
    setStep(0);
    const timers = [window.setTimeout(() => setStep(1), 700)];
    for (let i = 2; i <= order.length + 1; i++) timers.push(window.setTimeout(() => setStep(i), 700 + (i - 1) * 1900));
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, run, reduce]);

  const noteFor = (id: MemberId) => notes.find((n) => n.role === id);
  const gathered = step >= 1;
  const done = step > order.length;
  const shown = speaking ?? (done ? "head" : null);
  const member = DESK.find((d) => d.id === shown);
  const n = shown && shown !== "head" ? noteFor(shown) : undefined;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">The desk</div>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          aria-label="Replay the desk discussion"
        >
          <RotateCcw className="h-3 w-3" /> Replay
        </button>
      </div>

      {/* Figures: start spread out, gather toward the head trader, speaker steps forward. */}
      <div className="relative flex items-end justify-center gap-1 sm:gap-3 h-[78px]">
        {DESK.map((d, i) => {
          const offset = (i - 2) * (gathered ? 0 : 26);
          const active = shown === d.id;
          const dim = shown !== null && !active;
          return (
            <motion.div
              key={d.id}
              className="flex flex-col items-center"
              initial={false}
              animate={{ x: offset, y: active ? -6 : 0, opacity: dim ? 0.4 : 1, scale: active ? 1.08 : 1 }}
              transition={{ type: "spring", stiffness: 160, damping: 18 }}
            >
              <Figure id={d.id} tone={d.tone} size={d.id === "head" ? 44 : 36} />
              <span className={`mt-1 text-[9px] font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}>{d.name}</span>
            </motion.div>
          );
        })}
      </div>

      {/* What the current speaker says. */}
      <div className="mt-3 min-h-[64px]">
        <AnimatePresence mode="wait">
          {member && (
            <motion.div
              key={`${member.id}-${run}-${playKey}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="rounded-xl bg-muted/40 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${member.tone}`}>{member.name} <span className="font-normal text-muted-foreground">· {member.role}</span></span>
                {member.id === "head" ? (
                  <span className="text-xs font-semibold">{grade} · {bias}</span>
                ) : (
                  <span className={`text-[11px] font-semibold ${biasTone(n?.bias)}`}>
                    {biasWord(n?.bias)}{typeof n?.confidence === "number" && n.confidence > 0 ? ` ${n.confidence}%` : ""}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs leading-snug text-muted-foreground line-clamp-3">
                {member.id === "head"
                  ? verdict || `Weighing the four views, the call is ${grade}.`
                  : n?.summary || "No read on this one."}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Vote strip once the meeting is over. */}
      {done && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 grid grid-cols-4 gap-1.5">
          {DESK.filter((d) => d.id !== "head").map((d) => {
            const v = noteFor(d.id);
            return (
              <div key={d.id} className="rounded-lg border border-border/50 px-2 py-1 text-center">
                <div className="text-[9px] text-muted-foreground">{d.name}</div>
                <div className={`text-[10px] font-semibold ${biasTone(v?.bias)}`}>{biasWord(v?.bias)}</div>
              </div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
