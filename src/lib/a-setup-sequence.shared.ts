// Marcus's "real A setup" (Oct 2026): liquidity sweep -> change of character
// (close through the recent opposite swing) -> fair value gap inside the leg
// that gave the reversal -> retest of that gap -> entry on the retest candle.
// Evidence tier B (context.a_setup_sequence): may move the grade, never blocks.

import type { ObCandle } from "@/lib/orderBlocks";
import { findSweepAndBreak } from "@/lib/sequence-entry-shadow";

export type ASetupStep = "none" | "swept" | "choch" | "fvg" | "retest";

export type ASetupRead = {
  step: ASetupStep;
  /** 0-4: how many of sweep, CHoCH, FVG, retest are confirmed. */
  stepsDone: number;
  complete: boolean;
  fvgTop: number | null;
  fvgBot: number | null;
  retestTime: number | null;
  text: string;
};

const GRADE_ORDER = ["NO ENTRY", "C", "B", "A", "A+"] as const;
type G = (typeof GRADE_ORDER)[number];

export function readASetup(bias: "Long" | "Short" | "Neutral", c: ObCandle[]): ASetupRead {
  const empty = (text: string, step: ASetupStep = "none", stepsDone = 0): ASetupRead =>
    ({ step, stepsDone, complete: false, fvgTop: null, fvgBot: null, retestTime: null, text });
  if (bias === "Neutral" || c.length < 10) return empty("No directional bias, so no A-setup sequence.");
  const long = bias === "Long";
  const side = long ? "sell-side" : "buy-side";
  const confirm = findSweepAndBreak(c);
  if (!confirm || confirm.long !== long) {
    return empty(`A-setup check: no ${side} liquidity sweep followed by a change of character yet.`);
  }
  // Fair value gap inside the reversal leg (sweep candle through break candle).
  let gap: { top: number; bot: number } | null = null;
  for (let i = confirm.sweepI + 1; i <= confirm.breakI && i + 1 < c.length; i++) {
    const a = c[i - 1]!, b = c[i + 1]!;
    if (long && b.low > a.high) gap = { top: b.low, bot: a.high };
    if (!long && b.high < a.low) gap = { top: a.low, bot: b.high };
  }
  if (!gap) return empty("A-setup check: sweep and change of character confirmed, but the reversal leg left no fair value gap.", "choch", 2);
  const after = c.slice(confirm.breakI + 1);
  for (const bar of after) {
    // Invalidation: a close through the far side of the gap.
    if (long ? bar.close < gap.bot : bar.close > gap.top) {
      return { ...empty("A-setup check: price closed through the fair value gap, so the sequence failed.", "fvg", 3), fvgTop: gap.top, fvgBot: gap.bot };
    }
    if (long ? bar.low <= gap.top : bar.high >= gap.bot) {
      return {
        step: "retest", stepsDone: 4, complete: true, fvgTop: gap.top, fvgBot: gap.bot, retestTime: bar.time,
        text: `A-setup sequence complete: ${side} sweep, change of character, fair value gap in the reversal leg, and a retest of that gap. Entry belongs on the retest candle.`,
      };
    }
  }
  return { ...empty("A-setup check: sweep, change of character and fair value gap are in. Waiting for price to retest the gap.", "fvg", 3), fvgTop: gap.top, fvgBot: gap.bot };
}

/**
 * Grade effect. Complete sequence lifts one letter (A becomes A+) when no other cap binds.
 * An A without the sequence drops to B. Never produces NO ENTRY.
 */
export function applyASetup(grade: string, read: ASetupRead, otherCapBinding: boolean): { grade: string; action: "up" | "down" | "none" } {
  const i = GRADE_ORDER.indexOf(grade as G);
  if (i < 1) return { grade, action: "none" };
  if (read.complete) {
    if (!otherCapBinding && i < GRADE_ORDER.indexOf("A+")) return { grade: GRADE_ORDER[i + 1]!, action: "up" };
    return { grade, action: "none" };
  }
  if (i >= GRADE_ORDER.indexOf("A")) return { grade: "B", action: "down" };
  return { grade, action: "none" };
}
