// What should the trader do with this setup right now? One plain answer per
// scan, from the grade, direction, levels and current price. Advice only.

export type SetupActionKind = "enter" | "wait" | "missed" | "invalid" | "low_grade" | "stay_out";

export type SetupAction = { kind: SetupActionKind; label: string; detail: string };

/** Within this share of the risk (entry to stop) counts as "at the entry". */
export const AT_ENTRY_RISK_SHARE = 0.15;

export function setupAction(args: {
  grade: string;
  side: "long" | "short" | null;
  entry?: number;
  stop?: number;
  tp1?: number;
  price?: number;
  fmt?: (n: number) => string;
}): SetupAction {
  const { grade, side, entry, stop, tp1, price } = args;
  const f = args.fmt ?? ((n: number) => String(n));
  if (grade === "NO ENTRY" || !side || entry == null || stop == null) {
    return { kind: "stay_out", label: "Stay out", detail: "No trade on this scan. Wait for the next setup." };
  }
  const long = side === "long";
  const risk = Math.abs(entry - stop);
  if (price != null && Number.isFinite(price) && risk > 0) {
    if (long ? price <= stop : price >= stop) {
      return { kind: "invalid", label: "Skip, setup broken", detail: `Price ${f(price)} is already through the stop at ${f(stop)}.` };
    }
    if (tp1 != null && (long ? price >= tp1 : price <= tp1)) {
      return { kind: "missed", label: "Missed, don't chase", detail: `Price ${f(price)} already reached the first target at ${f(tp1)}.` };
    }
  }
  const lowGrade = grade === "C" || grade === "D";
  if (price != null && Number.isFinite(price) && risk > 0) {
    const pastEntry = long ? price <= entry : price >= entry;
    const near = Math.abs(price - entry) <= risk * AT_ENTRY_RISK_SHARE;
    if (pastEntry || near) {
      return lowGrade
        ? { kind: "low_grade", label: "Optional, low grade", detail: `Price is at the entry ${f(entry)}, but this is a ${grade}. Only take it at half size or less.` }
        : { kind: "enter", label: "Enter now", detail: `Price ${f(price)} is at the ${long ? "buy" : "sell"} entry ${f(entry)}. Stop ${f(stop)}.` };
    }
  }
  if (lowGrade) {
    return { kind: "low_grade", label: "Optional, low grade", detail: `${grade} setup. If you take it, use a ${long ? "buy" : "sell"} limit at ${f(entry)} and half size or less.` };
  }
  return { kind: "wait", label: "Wait for entry", detail: `Set a ${long ? "buy" : "sell"} limit at ${f(entry)}. Don't enter at market until price gets there.` };
}
