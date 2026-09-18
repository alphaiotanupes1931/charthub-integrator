// Wyckoff-only scanning engine — stripped to the core on purpose.
//
// This is a SECOND engine. It does not touch the production planner, the
// published grades or the strategy presets. It knows accumulation, distribution,
// markup, markdown, spring, upthrust and last point of support/supply, plus the
// protected break-of-structure read we already trust. That is all.
//
// Fully deterministic and pure: no network, no AI, no randomness. Give it the
// same closed bars twice and it returns the same plan twice. The AI is only ever
// handed the output to narrate.
//
// Entry order type is decided here, not by the trader. When price has already
// left the Wyckoff location in the direction of the trade, a pending LIMIT will
// either never fill or fill on the way back through — so the engine asks for a
// pending STOP on the continuation instead. This is the "every limit should have
// been a stop" complaint, expressed as a rule.

import { readProtectedStructure, type BosRead, type PsCandle } from "@/lib/protectedStructure";
import { WYCKOFF_RULEBOOK, WYCKOFF_RULEBOOK_VERSION } from "./rulebook";

export type WyCandle = PsCandle & { volume?: number };

export type WyPhase =
  | "accumulation"
  | "markup"
  | "distribution"
  | "markdown"
  | "consolidation"
  | "unreadable";

export type WyEventKind = "spring" | "upthrust" | "sos" | "sow" | "lps" | "lpsy";

export type WyEvent = {
  kind: WyEventKind;
  level: number;
  time: number;
  note: string;
};

export type WyRuleCheck = {
  id: number;
  title: string;
  pass: boolean;
  detail: string;
};

export type WyGrade = "A+" | "A" | "A-" | "B" | "C" | "NO ENTRY";

export type WyPlan = {
  rulebookVersion: string;
  phase: WyPhase;
  bias: "Long" | "Short" | "Neutral";
  grade: WyGrade;
  /** Why the grade is not higher, when something capped it. */
  cap: string | null;
  entry: number | null;
  /** limit = wait for price to come back. stop = take the continuation break. */
  entryOrder: "limit" | "stop" | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  rr: number | null;
  riskAtr: number | null;
  range: { high: number; low: number; width: number };
  atr: number;
  lastPrice: number;
  events: WyEvent[];
  bos: BosRead | null;
  rules: WyRuleCheck[];
  rulesPassed: number;
  note: string;
};

const BASE_BARS = 60;
const RECENT_BARS = 20;

export function wyAtr(candles: WyCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const rows = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const p = rows[i - 1];
    sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  return sum / period;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const dec = abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 3 : 5;
  return n.toFixed(dec);
}

/**
 * Read the phase, the Wyckoff events and the resulting plan.
 *
 * Returns an unreadable / NO ENTRY plan rather than throwing when the series is
 * too short or has no character — an honest "nothing here" is a valid answer and
 * the mode is supposed to say it often.
 */
export function readWyckoff(candles: WyCandle[]): WyPlan {
  const series = candles.slice(-(BASE_BARS + RECENT_BARS));
  const atr = wyAtr(series);
  const lastPrice = series.length ? series[series.length - 1].close : 0;

  const empty = (note: string, phase: WyPhase = "unreadable"): WyPlan => ({
    rulebookVersion: WYCKOFF_RULEBOOK_VERSION,
    phase,
    bias: "Neutral",
    grade: "NO ENTRY",
    cap: null,
    entry: null,
    entryOrder: null,
    stop: null,
    tp1: null,
    tp2: null,
    rr: null,
    riskAtr: null,
    range: { high: 0, low: 0, width: 0 },
    atr,
    lastPrice,
    events: [],
    bos: null,
    rules: WYCKOFF_RULEBOOK.map((r) => ({ id: r.id, title: r.title, pass: false, detail: "Not evaluated." })),
    rulesPassed: 0,
    note,
  });

  if (series.length < BASE_BARS + 5 || atr <= 0) {
    return empty("Not enough closed bars to read a phase. Nothing to trade here.");
  }

  const split = series.length - RECENT_BARS;
  const base = series.slice(0, split);
  const recent = series.slice(split);

  const rangeHigh = Math.max(...base.map((c) => c.high));
  const rangeLow = Math.min(...base.map((c) => c.low));
  const width = rangeHigh - rangeLow;
  const range = { high: rangeHigh, low: rangeLow, width };

  // ---- Wyckoff events on the recent bars, against the established range.
  const events: WyEvent[] = [];
  let springLow: number | null = null;
  let upthrustHigh: number | null = null;
  let sos = false;
  let sow = false;

  for (const c of recent) {
    if (c.low < rangeLow && c.close > rangeLow) {
      springLow = springLow === null ? c.low : Math.min(springLow, c.low);
      events.push({
        kind: "spring",
        level: c.low,
        time: c.time,
        note: `Spring: price traded to ${fmt(c.low)} under the range low ${fmt(rangeLow)} and closed back inside. Stops below were taken.`,
      });
    }
    if (c.high > rangeHigh && c.close < rangeHigh) {
      upthrustHigh = upthrustHigh === null ? c.high : Math.max(upthrustHigh, c.high);
      events.push({
        kind: "upthrust",
        level: c.high,
        time: c.time,
        note: `Upthrust: price pushed to ${fmt(c.high)} above the range high ${fmt(rangeHigh)} and closed back inside. Stops above were taken.`,
      });
    }
    if (c.close > rangeHigh) {
      sos = true;
      events.push({
        kind: "sos",
        level: c.close,
        time: c.time,
        note: `Sign of strength: closed at ${fmt(c.close)} above the range high ${fmt(rangeHigh)}.`,
      });
    }
    if (c.close < rangeLow) {
      sow = true;
      events.push({
        kind: "sow",
        level: c.close,
        time: c.time,
        note: `Sign of weakness: closed at ${fmt(c.close)} below the range low ${fmt(rangeLow)}.`,
      });
    }
  }

  // Last point of support / supply: after the break, price returned to the
  // broken edge and held it.
  if (sos) {
    for (const c of recent) {
      if (c.low <= rangeHigh + 0.5 * atr && c.low >= rangeHigh - 0.75 * atr && c.close > rangeHigh) {
        events.push({
          kind: "lps",
          level: rangeHigh,
          time: c.time,
          note: `Last point of support: pulled back to the broken high ${fmt(rangeHigh)} and held it.`,
        });
        break;
      }
    }
  }
  if (sow) {
    for (const c of recent) {
      if (c.high >= rangeLow - 0.5 * atr && c.high <= rangeLow + 0.75 * atr && c.close < rangeLow) {
        events.push({
          kind: "lpsy",
          level: rangeLow,
          time: c.time,
          note: `Last point of supply: rallied back to the broken low ${fmt(rangeLow)} and failed there.`,
        });
        break;
      }
    }
  }

  const hasLps = events.some((e) => e.kind === "lps");
  const hasLpsy = events.some((e) => e.kind === "lpsy");

  // ---- Phase. Breaks outrank ranges; a spring/upthrust outranks a quiet range.
  let phase: WyPhase;
  if (sos && !sow) phase = "markup";
  else if (sow && !sos) phase = "markdown";
  else if (springLow !== null) phase = "accumulation";
  else if (upthrustHigh !== null) phase = "distribution";
  else if (width <= 4 * atr) phase = "consolidation";
  else phase = "unreadable";

  const bias: WyPlan["bias"] =
    phase === "markup" || phase === "accumulation"
      ? "Long"
      : phase === "markdown" || phase === "distribution"
        ? "Short"
        : "Neutral";

  const bos = readProtectedStructure(candles.slice(-160));

  if (bias === "Neutral") {
    const plan = empty(
      phase === "consolidation"
        ? "Range with no spring and no upthrust yet. Wyckoff says wait: nothing has been taken."
        : "No readable Wyckoff phase. Stand down.",
      phase,
    );
    plan.range = range;
    plan.events = events;
    plan.bos = bos;
    plan.rules = [
      { id: 1, title: WYCKOFF_RULEBOOK[0].title, pass: false, detail: `Phase read as ${phase}, which gives no direction.` },
      ...WYCKOFF_RULEBOOK.slice(1).map((r) => ({ id: r.id, title: r.title, pass: false, detail: "Not evaluated — no phase, no trade." })),
    ];
    return plan;
  }

  const long = bias === "Long";

  // ---- Entry at a Wyckoff location.
  const zone =
    phase === "accumulation"
      ? rangeLow + 0.25 * atr
      : phase === "distribution"
        ? rangeHigh - 0.25 * atr
        : long
          ? rangeHigh
          : rangeLow;

  // Has price already left the location in our direction? Then a pending limit
  // is the wrong order: ask for the continuation stop instead.
  const gone = long ? lastPrice > zone + 0.5 * atr : lastPrice < zone - 0.5 * atr;
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  const entryOrder: "limit" | "stop" = gone ? "stop" : "limit";
  const entry = gone ? (long ? recentHigh + 0.1 * atr : recentLow - 0.1 * atr) : zone;

  // ---- Stop beyond the protected level.
  const protectedLevel =
    bos && bos.quality === "protected" && bos.protectedLevel !== null && bos.kind === (long ? "bullish" : "bearish")
      ? bos.protectedLevel
      : null;
  const anchor = long
    ? Math.min(springLow ?? rangeLow, protectedLevel ?? Infinity)
    : Math.max(upthrustHigh ?? rangeHigh, protectedLevel ?? -Infinity);
  const stop = long ? anchor - 0.15 * atr : anchor + 0.15 * atr;
  const risk = long ? entry - stop : stop - entry;

  // ---- Structural targets: range edge, then the measured move.
  const tp1 =
    phase === "accumulation"
      ? rangeHigh
      : phase === "distribution"
        ? rangeLow
        : long
          ? rangeHigh + 0.75 * width
          : rangeLow - 0.75 * width;
  const tp2 = long ? rangeHigh + 1.5 * width : rangeLow - 1.5 * width;
  const rr = risk > 0 ? (long ? tp1 - entry : entry - tp1) / risk : null;
  const riskAtr = risk > 0 ? risk / atr : null;

  // ---- The five rules, checked one at a time.
  const liquidityTaken = long
    ? springLow !== null || protectedLevel !== null
    : upthrustHigh !== null || protectedLevel !== null;
  const atLocation = phase === "accumulation" || phase === "distribution" || hasLps || hasLpsy || entryOrder === "limit";
  const stopOk = risk > 0 && riskAtr !== null && riskAtr <= 1.5;
  const targetOk = rr !== null && rr >= 2;

  const rules: WyRuleCheck[] = [
    {
      id: 1,
      title: WYCKOFF_RULEBOOK[0].title,
      pass: true,
      detail: `Phase is ${phase}, range ${fmt(rangeLow)} to ${fmt(rangeHigh)}. Bias ${bias}.`,
    },
    {
      id: 2,
      title: WYCKOFF_RULEBOOK[1].title,
      pass: liquidityTaken,
      detail: liquidityTaken
        ? long
          ? `Liquidity taken below${springLow !== null ? ` at the spring low ${fmt(springLow)}` : ""}${protectedLevel !== null ? `, protected low at ${fmt(protectedLevel)}` : ""}.`
          : `Liquidity taken above${upthrustHigh !== null ? ` at the upthrust high ${fmt(upthrustHigh)}` : ""}${protectedLevel !== null ? `, protected high at ${fmt(protectedLevel)}` : ""}.`
        : long
          ? "No spring and no protected low. Stops under this range have not been collected yet."
          : "No upthrust and no protected high. Stops above this range have not been collected yet.",
    },
    {
      id: 3,
      title: WYCKOFF_RULEBOOK[2].title,
      pass: atLocation,
      detail:
        entryOrder === "limit"
          ? `Entry ${fmt(entry)} is at the ${phase === "accumulation" ? "spring retest" : phase === "distribution" ? "upthrust retest" : long ? "last point of support" : "last point of supply"}. Pending limit.`
          : `Price has already left the location, so this is a pending STOP at ${fmt(entry)} on the continuation, not a limit back into it.`,
    },
    {
      id: 4,
      title: WYCKOFF_RULEBOOK[3].title,
      pass: stopOk,
      detail: stopOk
        ? `Stop ${fmt(stop)} sits beyond the protected level, risk ${riskAtr!.toFixed(2)} ATR.`
        : risk <= 0
          ? "Stop is on the wrong side of the entry. No valid trade."
          : `Risk ${riskAtr!.toFixed(2)} ATR is wider than the 1.5 ATR the book allows.`,
    },
    {
      id: 5,
      title: WYCKOFF_RULEBOOK[4].title,
      pass: targetOk,
      detail: targetOk
        ? `First target ${fmt(tp1)} at structure, ${rr!.toFixed(2)}R away.`
        : rr === null
          ? "No measurable reward."
          : `First target is only ${rr.toFixed(2)}R away. The book wants 2R minimum.`,
    },
  ];

  const rulesPassed = rules.filter((r) => r.pass).length;

  let grade: WyGrade =
    rulesPassed === 5 ? "A+" : rulesPassed === 4 ? "A" : rulesPassed === 3 ? "A-" : rulesPassed === 2 ? "B" : "C";
  let cap: string | null = null;

  // Caps only ever lower a grade.
  if (!rules[3].pass && risk <= 0) {
    grade = "NO ENTRY";
    cap = "Rule 4 failed outright: no valid stop.";
  } else if (!rules[1].pass) {
    grade = "C";
    cap = "Capped at C: rule 2 failed, the liquidity has not been taken yet.";
  } else if (!targetOk && grade !== "C") {
    grade = grade === "A+" || grade === "A" || grade === "A-" ? "B" : grade;
    cap = "Capped at B: rule 5 failed, the first target is closer than 2R.";
  }

  const note =
    grade === "NO ENTRY"
      ? "No valid Wyckoff trade on this series."
      : `${phase} — ${bias.toLowerCase()} ${entryOrder === "stop" ? "on a pending stop" : "on a pending limit"} at ${fmt(entry)}, stop ${fmt(stop)}, first target ${fmt(tp1)}. ${rulesPassed} of 5 rules pass.`;

  return {
    rulebookVersion: WYCKOFF_RULEBOOK_VERSION,
    phase,
    bias,
    grade,
    cap,
    entry,
    entryOrder,
    stop,
    tp1,
    tp2,
    rr,
    riskAtr,
    range,
    atr,
    lastPrice,
    events,
    bos,
    rules,
    rulesPassed,
    note,
  };
}
