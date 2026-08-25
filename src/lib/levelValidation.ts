// Deterministic sanity checks for trader-supplied entry / stop / target levels.
// Pure and isomorphic: used by the journal form for inline warnings and by the
// chat route to tell the coach exactly what looks wrong before it grades a
// setup off numbers that cannot be real.

export type Side = "Long" | "Short";

export type LevelInput = {
  side?: Side;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  /** Live/last price for the instrument, when known. */
  lastPrice?: number | null;
  /** ATR on the working timeframe, when known. */
  atr?: number | null;
};

export type LevelIssue = {
  field: "entry" | "stop" | "target" | "plan";
  severity: "error" | "warning";
  /** Plain-language explanation of what is wrong. */
  message: string;
  /** Concrete fix, in words. */
  suggestion: string;
  /** Numeric replacement to offer as a one-click fix, when one exists. */
  suggestedValue?: number;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Decimals to keep when suggesting a corrected level. */
function decimalsFor(ref: number): number {
  const a = Math.abs(ref);
  if (a >= 1000) return 2;
  if (a >= 100) return 2;
  if (a >= 10) return 3;
  if (a >= 1) return 4;
  return 5;
}

const round = (v: number, ref: number) => {
  const d = decimalsFor(ref);
  return Number(v.toFixed(d));
};

/**
 * Detects a pure decimal-place / magnitude typo, e.g. 740 typed for SPX at
 * 7400, or 19.42 for gold at 1942. Returns the rescaled value, or null.
 */
export function rescaleToReference(value: number, reference: number): number | null {
  if (!(value > 0) || !(reference > 0)) return null;
  const ratio = reference / value;
  for (const factor of [1000, 100, 10, 0.1, 0.01, 0.001]) {
    const scaled = value * factor;
    // Within 15% of the reference after scaling, and the raw value was not.
    if (Math.abs(scaled - reference) / reference < 0.15 && Math.abs(ratio - 1) > 0.3) {
      return round(scaled, reference);
    }
  }
  return null;
}

/** Infers the side from where the stop sits relative to entry. */
export function inferSide(entry: number, stop: number): Side | null {
  if (entry === stop) return null;
  return stop < entry ? "Long" : "Short";
}

export function validateLevels(input: LevelInput): LevelIssue[] {
  const entry = num(input.entry);
  const stop = num(input.stop);
  const target = num(input.target);
  const last = num(input.lastPrice);
  const atr = num(input.atr);
  const issues: LevelIssue[] = [];

  const side: Side | null = input.side ?? (entry != null && stop != null ? inferSide(entry, stop) : null);

  // 1. Non-positive prices are never a real level.
  for (const [field, v] of [["entry", entry], ["stop", stop], ["target", target]] as const) {
    if (v != null && v <= 0) {
      issues.push({
        field,
        severity: "error",
        message: `${field === "entry" ? "Entry" : field === "stop" ? "Stop" : "Target"} of ${v} is not a tradable price.`,
        suggestion: last != null ? `Use a price near the current ${round(last, last)}.` : "Enter the price as shown on your chart's price axis.",
        ...(last != null ? { suggestedValue: round(last, last) } : {}),
      });
    }
  }

  // 2. Decimal-place / magnitude typos against the live price.
  if (last != null) {
    for (const [field, v, label] of [["entry", entry, "Entry"], ["stop", stop, "Stop"], ["target", target, "Target"]] as const) {
      if (v == null || v <= 0) continue;
      const fixed = rescaleToReference(v, last);
      if (fixed != null) {
        issues.push({
          field,
          severity: "error",
          message: `${label} ${v} is off by a decimal place: this instrument is trading at ${round(last, last)}.`,
          suggestion: `Did you mean ${fixed}?`,
          suggestedValue: fixed,
        });
      }
    }
  }

  // 3. Entry sitting absurdly far from price.
  if (entry != null && entry > 0 && last != null) {
    const distPct = (Math.abs(entry - last) / last) * 100;
    const atrAway = atr && atr > 0 ? Math.abs(entry - last) / atr : null;
    const tooFar = atrAway != null ? atrAway > 5 : distPct > 5;
    if (tooFar) {
      issues.push({
        field: "entry",
        severity: "warning",
        message: atrAway != null
          ? `Entry ${entry} is ${atrAway.toFixed(1)} ATR (${distPct.toFixed(1)}%) away from the current ${round(last, last)}, so it may not fill for a long time.`
          : `Entry ${entry} is ${distPct.toFixed(1)}% away from the current ${round(last, last)}, so it may not fill for a long time.`,
        suggestion: "Confirm this is a resting order at a real structural level, or move the entry inside 2 ATR of price.",
      });
    }
  }

  // 4. Stop on the wrong side of entry.
  if (entry != null && stop != null && input.side) {
    const wrong = input.side === "Long" ? stop > entry : stop < entry;
    if (wrong && entry !== stop) {
      const mirrored = round(entry - (stop - entry), entry);
      issues.push({
        field: "stop",
        severity: "error",
        message: `On a ${input.side.toLowerCase()}, the stop must sit ${input.side === "Long" ? "below" : "above"} the entry. ${stop} is on the wrong side of ${entry}.`,
        suggestion: `Mirror it to ${mirrored}, or flip the side to ${input.side === "Long" ? "Short" : "Long"}.`,
        suggestedValue: mirrored,
      });
    }
  }

  // 5. Stop equals entry: no risk defined, so R math is impossible.
  if (entry != null && stop != null && entry === stop) {
    const pad = atr && atr > 0 ? atr * 0.5 : Math.abs(entry) * 0.002;
    const suggested = round(side === "Short" ? entry + pad : entry - pad, entry);
    issues.push({
      field: "stop",
      severity: "error",
      message: "Stop equals entry, so the trade has no defined risk and R cannot be calculated.",
      suggestion: `Place the stop beyond the level that invalidates the idea, for example ${suggested}.`,
      suggestedValue: suggested,
    });
  }

  // 6. Risk distance out of sane range versus ATR.
  if (entry != null && stop != null && entry !== stop && atr && atr > 0) {
    const risk = Math.abs(entry - stop);
    const mult = risk / atr;
    if (mult < 0.15) {
      const suggested = round(side === "Short" ? entry + atr * 0.5 : entry - atr * 0.5, entry);
      issues.push({
        field: "stop",
        severity: "warning",
        message: `Stop is only ${mult.toFixed(2)} ATR from entry, which normal noise will take out before the idea plays out.`,
        suggestion: `Widen it to roughly ${suggested} (about 0.5 ATR) and cut size to keep the same risk.`,
        suggestedValue: suggested,
      });
    } else if (mult > 4) {
      issues.push({
        field: "stop",
        severity: "warning",
        message: `Stop is ${mult.toFixed(1)} ATR from entry, so a single loss is unusually large for this timeframe.`,
        suggestion: "Tighten the stop to the nearest invalidation structure, or drop to a lower timeframe for the entry.",
      });
    }
  }

  // 7. Target on the wrong side of entry.
  if (entry != null && target != null && side) {
    const wrong = side === "Long" ? target <= entry : target >= entry;
    if (wrong) {
      const risk = stop != null ? Math.abs(entry - stop) : atr && atr > 0 ? atr : Math.abs(entry) * 0.005;
      const suggested = round(side === "Long" ? entry + risk * 2 : entry - risk * 2, entry);
      issues.push({
        field: "target",
        severity: "error",
        message: `On a ${side.toLowerCase()}, the target must sit ${side === "Long" ? "above" : "below"} the entry. ${target} would close the trade at a loss.`,
        suggestion: `Use ${suggested} for a 2R target, or flip the side.`,
        suggestedValue: suggested,
      });
    }
  }

  // 8. Reward-to-risk below 1: the plan needs a high hit rate to break even.
  if (entry != null && stop != null && target != null && entry !== stop && side) {
    const risk = Math.abs(entry - stop);
    const reward = side === "Long" ? target - entry : entry - target;
    if (reward > 0 && risk > 0) {
      const rr = reward / risk;
      if (rr < 1) {
        const suggested = round(side === "Long" ? entry + risk * 2 : entry - risk * 2, entry);
        issues.push({
          field: "plan",
          severity: "warning",
          message: `Reward to risk is ${rr.toFixed(2)}R, so you need to win more than ${Math.round((1 / (1 + rr)) * 100)}% of these just to break even.`,
          suggestion: `Move the target to ${suggested} for 2R, or tighten the stop to the real invalidation level.`,
          suggestedValue: suggested,
        });
      }
    }
  }

  return issues;
}

/** Pulls entry / stop / target numbers a trader typed in a chat message. */
export function parseStatedLevels(text: string): { entry?: number; stop?: number; target?: number; side?: Side } {
  const out: { entry?: number; stop?: number; target?: number; side?: Side } = {};
  const grab = (re: RegExp) => {
    const m = text.match(re);
    const n = m ? Number(m[1]?.replace(/,/g, "")) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  out.entry = grab(/\b(?:entry|entered|buy(?:ing)?|sell(?:ing)?|long|short)\b[^0-9\-]{0,14}(-?[\d,]+(?:\.\d+)?)/i);
  out.stop = grab(/\b(?:stop|sl|stop\s*loss|invalidation)\b[^0-9\-]{0,14}(-?[\d,]+(?:\.\d+)?)/i);
  out.target = grab(/\b(?:target|tp1?|take\s*profit)\b[^0-9\-]{0,14}(-?[\d,]+(?:\.\d+)?)/i);
  if (/\b(short|sell)\b/i.test(text)) out.side = "Short";
  if (/\b(long|buy)\b/i.test(text)) out.side = "Long";
  return out;
}

/** System-prompt block describing what is wrong with the trader's own levels. */
export function levelCheckBlock(input: LevelInput): string | null {
  const issues = validateLevels(input);
  if (!issues.length) return null;
  const lines = issues.map(
    (i) => `- [${i.severity}] ${i.field}: ${i.message} Fix: ${i.suggestion}`,
  );
  return `TRADER-SUPPLIED LEVEL CHECK (computed, not your opinion):
${lines.join("\n")}
Rules for this reply:
- Still use the trader's own levels as the levels; never silently swap in your own or an earlier scan's.
- Open with one short sentence naming the problem above in plain language, then give the suggested correction with its number.
- If an [error] is listed, say the plan cannot be graded as typed and ask them to confirm or accept the correction before you grade it.
- If only [warning] items are listed, grade the setup but state the warning and cap the grade at C when reward to risk is under 1.`;
}
