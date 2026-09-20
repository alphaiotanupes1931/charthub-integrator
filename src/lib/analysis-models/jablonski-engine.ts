// Eric Jablonski engine — deterministic core for Model 4.
//
// Implements the whole rulebook (jablonski-rulebook.ts), which is short enough
// to be checked end to end in code: 15-minute closed bars only (rule 1), the
// opening range from the session's first two 15-minute candles (rule 2), a
// 15-minute CLOSE outside the range as the only trigger (rule 3), entry in the
// break's direction at that close (rule 4), stop at the opposite end of the
// range (rule 5), a fixed 10-point target (rule 6), and NO ENTRY on any
// instrument without a conventional point size (rule 7).
//
// Pure and deterministic: no network, no AI, no randomness. The AI only ever
// narrates this output; it cannot move direction, entry, stop, target or grade.

import { JABLONSKI_RULEBOOK_VERSION } from "./jablonski-rulebook";

export type JablonskiCandle = { time: number; open: number; high: number; low: number; close: number };

export type JablonskiGrade = "A" | "B" | "C" | "NO ENTRY";

export type JablonskiRuleCheck = { id: number; title: string; pass: boolean; detail: string };

export type JablonskiRead = {
  rulebookVersion: string;
  bias: "Long" | "Short" | "Neutral";
  grade: JablonskiGrade;
  cap: string | null;
  phase: "no-range" | "awaiting-break" | "broken" | "closed-back-inside" | "unsupported";
  rangeHigh: number | null;
  rangeLow: number | null;
  /** New York local date of the session whose opening range is in play. */
  sessionDay: string | null;
  /** Points, in the instrument's own units, used for the fixed target. */
  pointSize: number | null;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  rr: number | null;
  /** Closed 15m bars since the break candle. */
  barsSinceBreak: number | null;
  lastPrice: number;
  rules: JablonskiRuleCheck[];
  note: string;
};

/** How many points the fixed target is, straight from rule 6. */
export const JABLONSKI_TARGET_POINTS = 10;

/** A break older than this has already made its move; entering now is chasing. */
const MAX_BARS_SINCE_BREAK = 8;

const ZONE = "America/New_York";

type Stamp = { date: string; hour: number; minute: number; weekday: string };
const stampCache = new Map<number, Stamp>();

function localStamp(time: number): Stamp {
  const cached = stampCache.get(time);
  if (cached) return cached;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(time * 1000));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const stamp: Stamp = {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    weekday: part("weekday"),
  };
  stampCache.set(time, stamp);
  return stamp;
}

const norm = (symbol: string) => symbol.toUpperCase().replace(/[\s_/-]/g, "");

/**
 * The instrument's point, in price units. A fixed 10-point target is only
 * meaningful where the market quotes a conventional point, so anything not
 * listed here returns null and the model stands down (rule 7).
 */
export function jablonskiPointSize(symbol: string): number | null {
  const s = norm(symbol);
  // Index CFDs and oil quote whole points.
  if (/^(NAS100|US100|SPX500|US500|US30|DOW|GER30|DE30|DE40|UK100|FRA40|JP225|AUS200|HK50|CHINA50|CN50|USTEC)/.test(s)) return 1;
  if (/^(WTI|USOIL|UKOIL|BRENT|NATGAS|XTIUSD|XBRUSD)/.test(s)) return 0.01;
  if (s.startsWith("XAU")) return 1; // gold: one dollar
  if (s.startsWith("XAG")) return 0.01; // silver: one cent
  // Crypto has no conventional point, so it is out of scope even though tickers
  // like BTCUSD look like an FX pair.
  if (/^(BTC|ETH|XRP|SOL|LTC|BCH|ADA|DOGE|AVAX|LINK|DOT|MATIC)/.test(s)) return null;
  // FX: a point is the last quoted decimal of the conventional pip.
  if (/^[A-Z]{6}$/.test(s)) return s.includes("JPY") ? 0.01 : 0.0001;
  return null;
}

/**
 * Session open in New York local time. US index CFDs use the cash open; FX,
 * metals and oil use the London open, which is where the first two candles of
 * the day actually carry the volume this method depends on.
 */
export function jablonskiSessionOpen(symbol: string): { hour: number; minute: number } {
  const s = norm(symbol);
  if (/^(NAS100|US100|SPX500|US500|US30|DOW|USTEC)/.test(s)) return { hour: 9, minute: 30 };
  return { hour: 3, minute: 0 };
}

const round5 = (v: number) => Math.round(v * 100000) / 100000;
const fmt = (v: number | null): string => (v == null ? "-" : String(round5(v)));

/** Deterministic Eric Jablonski read over closed 15-minute bars. */
export function jablonskiAnalysis(candles: JablonskiCandle[], symbol: string): JablonskiRead {
  const lastPrice = candles.length ? candles[candles.length - 1]!.close : 0;
  const rules: JablonskiRuleCheck[] = [];
  const check = (id: number, title: string, pass: boolean, detail: string) => rules.push({ id, title, pass, detail });

  const read: JablonskiRead = {
    rulebookVersion: JABLONSKI_RULEBOOK_VERSION,
    bias: "Neutral",
    grade: "NO ENTRY",
    cap: null,
    phase: "no-range",
    rangeHigh: null,
    rangeLow: null,
    sessionDay: null,
    pointSize: null,
    entry: null,
    stop: null,
    tp1: null,
    rr: null,
    barsSinceBreak: null,
    lastPrice,
    rules,
    note: "",
  };

  const point = jablonskiPointSize(symbol);
  check(7, "Only instruments with a defined point", point != null,
    point != null ? `one point = ${round5(point)}` : `${symbol} has no conventional point size for a fixed 10-point target`);
  if (point == null) {
    read.phase = "unsupported";
    read.note = `${symbol} has no conventional point, so a fixed 10-point target has no meaning here. This model stands down.`;
    return read;
  }
  read.pointSize = point;

  check(1, "Trade the 15-minute chart only", candles.length >= 3,
    candles.length >= 3 ? `${candles.length} closed 15-minute bars` : "not enough closed 15-minute bars");
  if (candles.length < 3) {
    read.note = "Not enough closed 15-minute bars to mark an opening range.";
    return read;
  }

  // Rule 2: the opening range is the first two 15-minute candles of the most
  // recent session that actually printed them.
  const open = jablonskiSessionOpen(symbol);
  const openMinutes = open.hour * 60 + open.minute;
  let firstIndex: number | null = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    const st = localStamp(candles[i]!.time);
    if (st.hour * 60 + st.minute === openMinutes) { firstIndex = i; break; }
  }
  if (firstIndex == null || firstIndex + 1 >= candles.length) {
    check(2, "Mark the opening range", false, `no ${String(open.hour).padStart(2, "0")}:${String(open.minute).padStart(2, "0")} New York opening candle pair in the closed bars`);
    read.note = "The session's first two 15-minute candles are not in the closed data yet, so there is no range and no trade.";
    return read;
  }

  const first = candles[firstIndex]!;
  const second = candles[firstIndex + 1]!;
  const rangeHigh = Math.max(first.high, second.high);
  const rangeLow = Math.min(first.low, second.low);
  read.rangeHigh = round5(rangeHigh);
  read.rangeLow = round5(rangeLow);
  read.sessionDay = localStamp(first.time).date;
  read.phase = "awaiting-break";
  check(2, "Mark the opening range", true,
    `${read.sessionDay} opening range ${fmt(rangeLow)} to ${fmt(rangeHigh)} from the first two 15-minute candles`);

  // Rule 3/4: the first 15-minute CLOSE outside the range, after the range is set.
  let breakIndex: number | null = null;
  let side: "Long" | "Short" | null = null;
  for (let i = firstIndex + 2; i < candles.length; i++) {
    const cl = candles[i]!.close;
    if (cl > rangeHigh) { breakIndex = i; side = "Long"; break; }
    if (cl < rangeLow) { breakIndex = i; side = "Short"; break; }
  }
  if (breakIndex == null || !side) {
    check(3, "Wait for a 15-minute close outside the range", false, "no 15-minute candle has closed outside the range yet");
    read.note = `Opening range ${fmt(rangeLow)} to ${fmt(rangeHigh)} is intact. No 15-minute close outside it, so the model waits.`;
    return read;
  }
  check(3, "Wait for a 15-minute close outside the range", true,
    `${side === "Long" ? "close above" : "close below"} the range at ${fmt(candles[breakIndex]!.close)}`);

  // Rule 4 invalidation: a close back inside the range ends the break.
  let backInside = false;
  for (let i = breakIndex + 1; i < candles.length; i++) {
    const cl = candles[i]!.close;
    if (cl <= rangeHigh && cl >= rangeLow) { backInside = true; break; }
  }
  if (backInside) {
    read.phase = "closed-back-inside";
    check(4, "Take the break in its direction", false, "price closed back inside the range, so that break is finished");
    read.note = `The ${side === "Long" ? "upside" : "downside"} break closed back inside the opening range, so this model stands down for the session.`;
    return read;
  }
  check(4, "Take the break in its direction", true, `${side} at the break candle's close`);

  const entry = candles[breakIndex]!.close;
  const stop = side === "Long" ? rangeLow : rangeHigh;
  const tp1 = side === "Long" ? entry + JABLONSKI_TARGET_POINTS * point : entry - JABLONSKI_TARGET_POINTS * point;
  const risk = Math.abs(entry - stop);
  const rr = risk > 0 ? Math.abs(tp1 - entry) / risk : null;
  const barsSinceBreak = candles.length - 1 - breakIndex;

  check(5, "Stop at the opposite end of the range", risk > 0,
    risk > 0 ? `stop at the range ${side === "Long" ? "low" : "high"} ${fmt(stop)} (${round5(risk)} risk)` : "opening range has no height");
  check(6, "Fixed 10-point target", true, `target ${fmt(tp1)} = ${JABLONSKI_TARGET_POINTS} points from ${fmt(entry)}`);

  if (risk <= 0) {
    read.note = "The opening range has no height, so there is no stop to use.";
    return read;
  }

  // Grade. The method has no discretionary filters, so the only thing that can
  // separate one signal from another is how fresh the break is and how wide the
  // range made the risk against a fixed 10-point target.
  let cap: string | null = null;
  let grade: JablonskiGrade = "A";
  if (barsSinceBreak > MAX_BARS_SINCE_BREAK) {
    grade = "C";
    cap = `the break closed ${barsSinceBreak} bars ago — entering now is chasing`;
  } else if (rr != null && rr < 0.25) {
    grade = "C";
    cap = `the opening range is wide: risking ${round5(risk)} for ${JABLONSKI_TARGET_POINTS} points is ${rr.toFixed(2)}R`;
  } else if (barsSinceBreak > 2 || (rr != null && rr < 0.5)) {
    grade = "B";
    cap = barsSinceBreak > 2
      ? `the break closed ${barsSinceBreak} bars ago`
      : `risking ${round5(risk)} for ${JABLONSKI_TARGET_POINTS} points is ${rr!.toFixed(2)}R`;
  }
  if (side === "Long" ? lastPrice >= tp1 : lastPrice <= tp1) {
    grade = "NO ENTRY";
    cap = "price has already reached the 10-point target";
  }

  read.bias = side;
  read.phase = "broken";
  read.grade = grade;
  read.cap = cap;
  read.barsSinceBreak = barsSinceBreak;
  read.entry = round5(entry);
  read.stop = round5(stop);
  read.tp1 = round5(tp1);
  read.rr = rr == null ? null : Math.round(rr * 100) / 100;
  read.note = grade === "NO ENTRY"
    ? `The ${side.toLowerCase()} break already ran the full ${JABLONSKI_TARGET_POINTS} points, so there is nothing left to take.`
    : `${grade} ${side}: 15-minute close ${side === "Long" ? "above" : "below"} the ${fmt(rangeLow)}–${fmt(rangeHigh)} opening range. Entry ${fmt(entry)}, stop at the opposite end ${fmt(stop)}, fixed ${JABLONSKI_TARGET_POINTS}-point target ${fmt(tp1)} (${read.rr}R).${cap ? ` Capped: ${cap}.` : ""}`;
  return read;
}

/** The authoritative block handed to the planner/coach for Model 4 scans. */
export function jablonskiContextBlock(read: JablonskiRead, ticker: string, interval: string): string {
  const lines = read.rules.map((r) => `  Rule ${r.id} ${r.title}: ${r.pass ? "PASS" : "FAIL"} - ${r.detail}`);
  return [
    `ERIC JABLONSKI MODEL — DETERMINISTIC READ (${read.rulebookVersion}) for ${ticker}, decided on closed 15-minute bars (scan interval ${interval}).`,
    "This model is fed ONLY the Eric Jablonski opening-range rulebook. No order blocks, no fair value gaps, no market-structure mapping, no other model's library applies.",
    "The numbers below are computed in code from closed bars. You narrate them; you may not contradict or move direction, entry, stop, target, or grade.",
    `Phase: ${read.phase}. Bias: ${read.bias}. Grade: ${read.grade}.${read.cap ? ` Cap: ${read.cap}.` : ""}`,
    read.rangeHigh != null ? `Opening range (${read.sessionDay}): ${fmt(read.rangeLow)} to ${fmt(read.rangeHigh)}.` : "No opening range available.",
    read.entry != null
      ? `Setup: ${read.bias} on the 15-minute close outside the range. Entry ${fmt(read.entry)}, stop ${fmt(read.stop)}, fixed ${JABLONSKI_TARGET_POINTS}-point target ${fmt(read.tp1)} (${read.rr}R). No trailing, no partials — it resolves at target or stop.`
      : "No valid setup, so the answer is NO ENTRY.",
    `Last close: ${fmt(read.lastPrice)}.`,
    "Rule checks:",
    ...lines,
    read.note,
  ].join("\n");
}
