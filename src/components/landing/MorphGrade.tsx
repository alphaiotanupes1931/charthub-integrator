import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";

/**
 * One shape that morphs through the product's core flow:
 * button -> grading -> grade -> signal card -> grade rail, then loops.
 * Uses the site's real copy and the sample setup shown further down the page.
 */
type State = "button" | "loading" | "grade" | "card" | "rail";
const ORDER: { s: State; ms: number }[] = [
  { s: "button", ms: 1500 },
  { s: "loading", ms: 1000 },
  { s: "grade", ms: 1500 },
  { s: "card", ms: 3000 },
  { s: "rail", ms: 3500 },
];

const SIZE: Record<State, { w: number; h: number; r: number }> = {
  button: { w: 220, h: 52, r: 26 },
  loading: { w: 52, h: 52, r: 26 },
  grade: { w: 132, h: 132, r: 28 },
  card: { w: 340, h: 172, r: 18 },
  rail: { w: 480, h: 96, r: 16 },
};

const spring = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };
const swap = {
  initial: { opacity: 0, filter: "blur(3px)", scale: 0.965 },
  animate: { opacity: 1, filter: "blur(0px)", scale: 1, transition: { delay: 0.07, duration: 0.28 } },
  exit: { opacity: 0, filter: "blur(3px)", scale: 0.965, transition: { duration: 0.14 } },
};

const RAIL = [
  { g: "A+", l: "Take it", cls: "text-primary" },
  { g: "A", l: "Strong", cls: "text-bull" },
  { g: "B", l: "Optional", cls: "text-foreground/70" },
  { g: "C", l: "Skip", cls: "text-destructive" },
];

export function MorphGrade() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(4);

  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setI((n) => (n + 1) % ORDER.length), ORDER[i].ms);
    return () => clearTimeout(t);
  }, [i, reduce]);

  const state = reduce ? "rail" : ORDER[i].s;
  const sz = SIZE[state];
  const filled = state === "button" || state === "loading";

  return (
    <div className="h-[180px] flex items-center justify-center" aria-label="TradeMind grades every setup A+ to C">
      <motion.div
        animate={{
          width: `min(${sz.w}px, 92vw)`,
          height: sz.h,
          borderRadius: sz.r,
        }}
        transition={spring}
        className={`relative overflow-hidden border flex items-center justify-center ${
          filled ? "bg-primary border-primary text-primary-foreground" : "bg-card/70 border-border/70 text-foreground"
        } ${state === "grade" ? "border-primary/60" : ""}`}
        style={{ transition: "background-color 300ms, border-color 300ms" }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {state === "button" && (
            <motion.span key="b" {...swap} className="text-sm font-semibold whitespace-nowrap">
              Grade the setup
            </motion.span>
          )}
          {state === "loading" && (
            <motion.span key="l" {...swap} className="block">
              <motion.span
                className="block h-5 w-5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
              />
            </motion.span>
          )}
          {state === "grade" && (
            <motion.div key="g" {...swap} className="text-center">
              <div className="font-display text-6xl leading-none text-primary">A+</div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Take it</div>
            </motion.div>
          )}
          {state === "card" && (
            <motion.div key="c" {...swap} className="w-full px-5 text-left">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold tracking-wide">XAU/USD · LONG</div>
                <div className="font-display text-2xl leading-none text-primary">A+</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs">
                {[
                  ["Entry", "4,045.48"],
                  ["Stop", "4,034.76"],
                  ["TP1", "4,066.61"],
                  ["TP2", "4,085.72"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-bull">
                <Check className="h-3.5 w-3.5" /> 4H · 1H · 15m aligned
              </div>
            </motion.div>
          )}
          {state === "rail" && (
            <motion.div key="r" {...swap} className="grid grid-cols-4 w-full h-full">
              {RAIL.map((x, n) => (
                <div
                  key={x.g}
                  className={`flex flex-col items-center justify-center ${n ? "border-l border-border/60" : ""} ${x.cls}`}
                >
                  <div className="font-display text-3xl leading-none">{x.g}</div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{x.l}</div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
