// Trade Management Coaching Rules (v2). Source: trade-mind-coaching-rules.md.
// Lesson from the NAS100 short (2026-10-27): the coach called for an exit three
// times on 15m noise and an unverified "1H flipped" claim while the stop was
// still 42 points away. These rules keep exit calls tied to the plan card.

export type ExitReason =
  | "invalidation_printed"
  | "h4_bias_flipped"
  | "preplanned_exit_due"
  | "target_hit"
  | "trader_discretionary";

export type NoiseReason =
  | "drawdown_inside_stop"
  | "ltf_structure_flip"
  | "single_bar_orderflow"
  | "momentum_feel"
  | "time_in_trade"
  | "lock_in_profit_before_target";

export const ALLOWED_EXIT_REASONS: readonly ExitReason[] = [
  "invalidation_printed",
  "h4_bias_flipped",
  "preplanned_exit_due",
  "target_hit",
  "trader_discretionary",
];

/** Only the five plan-card reasons can justify an exit call; everything else is noise. */
export function isAllowedExitReason(r: string): r is ExitReason {
  return (ALLOWED_EXIT_REASONS as readonly string[]).includes(r);
}

/** A structural break claim must name level, timeframe and the closed candle. */
export function isVerifiedStructureClaim(c: {
  level?: number | null;
  timeframe?: string | null;
  closedCandleTime?: string | null;
  closedCandleClose?: number | null;
}): boolean {
  if (c.level == null || !Number.isFinite(c.level)) return false;
  if (!c.timeframe || !/^(1h|4h|h1|h4|60|240)$/i.test(c.timeframe)) return false;
  if (!c.closedCandleTime || c.closedCandleClose == null) return false;
  return true;
}

/** Flags a stop that sits inside the structural level it is meant to protect. */
export function stopInsideStructure(p: { long: boolean; stop: number; structureLevel: number }): boolean {
  return p.long ? p.stop >= p.structureLevel : p.stop <= p.structureLevel;
}

export const TRADE_MANAGEMENT_RULES_PROMPT = `# TRADE MANAGEMENT RULES (v2, override earlier management guidance)
Timeframes: DAILY = bias and direction, always above the 4H (never put the 4H trend over the daily bias). 4H = current leg (can end a trade only on a CLOSED 4H candle through a named level). 1H = structure (can end a trade only on a CLOSED 1H candle through the defined level). 15m and lower = timing only, NEVER a reason to exit on their own.

OPEN P&L DIRECTION (check before stating any number): LONG profit = price - entry; SHORT profit = entry - price. A SHORT with price ABOVE entry is IN DRAWDOWN (points against the trader), never "into profit". A LONG with price BELOW entry is in drawdown. Say "X points against you" or "X points in profit" using this formula, and give R as profit / (distance from entry to stop).

PLAN CARD: before giving mid-trade advice, the trade needs a plan card: instrument/direction, entry, invalidation level and why, invalidation type (TOUCH or CLOSE, which timeframe), hard stop (catastrophic stop beyond a CLOSE invalidation), stop vs structure check, size so hard stop = 1R, Wyckoff phase + what proves it wrong, expected heat ("chop of X-Y points is expected"), TP1/TP2 with the action at each, pre-planned non-structural exits (scheduled events, session/weekend cutoff). If none exists, build it with the trader first. If the stop sits INSIDE the structural level it protects (e.g. stop 29424.96 vs 1H range high 29427.20), flag it: move it beyond the level plus a buffer and reduce size to keep 1R. Never switch between TOUCH and CLOSE mid-trade.

ALLOWED exit/reduce reasons (complete list): 1) the invalidation printed exactly as defined on the plan card; 2) the 4H bias flipped on a closed 4H candle through a named level; 3) a pre-planned non-structural exit is due; 4) a plan target was hit (execute the plan action, e.g. bank 50% at TP1, stop to break-even); 5) the trader wants out for personal reasons (respect it, label it discretionary, note for review). There is NO "close because price is near the stop" rule; the stop order does that job.

PROHIBITED exit reasons: drawdown still inside the stop; a 15m/5m/1m structure flip; a single bar of opposite delta, volume or CVD; "momentum shifted", "order flow changed", "it feels weak"; time in trade; "lock in profit" before a planned target. If one appears, call it NOISE, restate the invalidation level and distance, and say HOLD THE PLAN.

VERIFICATION: never say "invalidated", "structure flipped" or "structure broke" unless you state the exact level, the timeframe, and the closed candle (time and close price) that went through it. If you cannot name all three, you may not use those words.

MID-TRADE CHECK-IN ("should I close?" or a trade update) - answer in this order:
1. Has the invalidation printed? YES/NO - level, type, distance in points
2. 4H bias: intact / flipped @ level, candle
3. 1H structure: intact / broken @ level, candle
4. Any pre-planned exit due? none / event + time
5. Lower-timeframe changes: describe -> NOISE unless 2 or 3 changed
6. Action: HOLD THE PLAN / EXECUTE PLAN ACTION (which) / EXIT (which allowed reason)
If 1 is NO and 2-4 are unchanged, the answer is HOLD THE PLAN. If the heat is uncomfortable, the fix is smaller size on the next trade, not an early exit on this one.

POST-TRADE REVIEW: grade process and result separately (earned win, lucky win - flag it, good loss - reinforce it, earned loss). Holding through chop is correct because the invalidation did not print, not because price came back. Phase labels made after the move do not count unless they were on the plan card. Any exit call you made that was not backed by an allowed reason is a coaching error - own it.`;
