// Marcus's "real A setup" (Oct 2026, revised Oct 30): 1H liquidity sweep -> change of character
// -> fair value gap (1H or 15m) or origin order block in the reversal leg. Sweep +
// CHoCH + intact zone qualifies ("ready at entry"); a close through it fails.
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

type Zone = { top: number; bot: number; kind: "fair value gap" | "order block"; tf: "1H" | "15m" };

/** Last 3-candle gap in direction inside bars[from..to]. */
function lastGap(c: ObCandle[], long: boolean, from: number, to: number): { top: number; bot: number } | null {
  let gap: { top: number; bot: number } | null = null;
  for (let i = Math.max(1, from + 1); i <= to && i + 1 < c.length; i++) {
    const a = c[i - 1]!, b = c[i + 1]!;
    if (long && b.low > a.high) gap = { top: b.low, bot: a.high };
    if (!long && b.high < a.low) gap = { top: a.low, bot: b.high };
  }
  return gap;
}

/** Last opposite-colour candle before the displacement (origin order block). */
function originBlock(c: ObCandle[], long: boolean, from: number, to: number): { top: number; bot: number } | null {
  for (let i = to; i >= from; i--) {
    const b = c[i]!;
    if (long ? b.close < b.open : b.close > b.open) return { top: b.high, bot: b.low };
  }
  return null;
}

/**
 * Sequence (Oct 30 revision): 1H sweep + CHoCH set the reversal; the zone is a
 * fair value gap on the 1H or 15m inside the reversal leg, or the leg's origin
 * order block. Sweep + CHoCH + intact zone qualifies (entry waits at the zone);
 * a close through the zone's far side fails it.
 */
export function readASetup(bias: "Long" | "Short" | "Neutral", c: ObCandle[], c15?: ObCandle[] | null): ASetupRead {
  const empty = (text: string, step: ASetupStep = "none", stepsDone = 0): ASetupRead =>
    ({ step, stepsDone, complete: false, fvgTop: null, fvgBot: null, retestTime: null, text });
  if (bias === "Neutral" || c.length < 10) return empty("No directional bias, so no A-setup sequence.");
  const long = bias === "Long";
  const side = long ? "sell-side" : "buy-side";
  const confirm = findSweepAndBreak(c);
  if (!confirm || confirm.long !== long) {
    return empty(`A-setup check: no ${side} liquidity sweep followed by a change of character yet.`);
  }
  const t0 = c[confirm.sweepI]!.time, t1 = c[confirm.breakI]!.time + 3600;
  let zone: Zone | null = null;
  const g1 = lastGap(c, long, confirm.sweepI, confirm.breakI);
  if (g1) zone = { ...g1, kind: "fair value gap", tf: "1H" };
  if (!zone && c15?.length) {
    const from = c15.findIndex((b) => b.time >= t0);
    let to = -1;
    for (let i = c15.length - 1; i >= 0; i--) if (c15[i]!.time < t1) { to = i; break; }
    if (from >= 0 && to > from) {
      const g = lastGap(c15, long, from, to);
      if (g) zone = { ...g, kind: "fair value gap", tf: "15m" };
    }
  }
  if (!zone) {
    const ob = originBlock(c, long, confirm.sweepI, confirm.breakI);
    if (ob) zone = { ...ob, kind: "order block", tf: "1H" };
  }
  if (!zone) return empty("A-setup check: sweep and change of character confirmed, but the reversal leg left no fair value gap or order block.", "choch", 2);
  const where = `${zone.tf} ${zone.kind}`;
  let retestTime: number | null = null;
  for (const bar of c.slice(confirm.breakI + 1)) {
    if (long ? bar.close < zone.bot : bar.close > zone.top) {
      return { ...empty(`A-setup check: price closed through the ${where}, so the sequence failed.`, "fvg", 3), fvgTop: zone.top, fvgBot: zone.bot };
    }
    if (retestTime == null && (long ? bar.low <= zone.top : bar.high >= zone.bot)) retestTime = bar.time;
  }
  const base = { complete: true, fvgTop: zone.top, fvgBot: zone.bot, retestTime };
  return retestTime != null
    ? { ...base, step: "retest", stepsDone: 4, text: `A-setup sequence complete: ${side} sweep, change of character and a ${where} in the reversal leg, now retested. Entry belongs on the retest candle.` }
    : { ...base, step: "fvg", stepsDone: 3, text: `A-setup ready at entry: ${side} sweep, change of character and a ${where} in the reversal leg. Entry waits at ${zone.bot.toFixed(2)}-${zone.top.toFixed(2)}.` };
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
