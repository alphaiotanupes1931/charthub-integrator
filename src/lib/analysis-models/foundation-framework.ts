// The owner's seven-day trading foundation, written for traders and now taught
// by the coach in the same words.
//
// Two jobs, kept apart on purpose:
//  - Teaching: the coach may explain, quote and drill any of this.
//  - Scanning: none of it decides a live direction, grade, entry, stop or target.
//    The six-dimension score below is a shadow measurement until it has been
//    tested against filed signals with held-out data, exactly like every other
//    research rule in this codebase.
//
// Statements about win rates deserve special care: the material itself insists a
// number without sample size, date range and instrument is decoration. The coach
// must hold that line and refuse to quote a hit rate the scoreboard cannot show.

export const FOUNDATION_FRAMEWORK_VERSION = "foundation-1.0-teaching";

/** The six dimensions a setup is scored on. Teaching order matters, so it is fixed. */
export const SIX_DIMENSIONS = [
  {
    id: "structure",
    title: "Structure",
    question: "Does the trade go with the structure, or against it?",
  },
  {
    id: "momentum",
    title: "Momentum",
    question: "Is there force behind the move, or is it drifting?",
  },
  {
    id: "risk",
    title: "Risk",
    question: "Where exactly are you wrong, and what does that make your size?",
  },
  {
    id: "confluence",
    title: "Confluence",
    question: "How many independent reasons point the same way?",
  },
  {
    id: "session",
    title: "Session",
    question: "Does this instrument actually move at this hour?",
  },
  {
    id: "track-record",
    title: "Track record",
    question: "What happens when you trade this pattern?",
  },
] as const;

export type DimensionId = (typeof SIX_DIMENSIONS)[number]["id"];

/**
 * The gate the material states: strong on structure and risk, plus at least two
 * others. Scores are 1-5; "strong" is 4 or better.
 */
export const STRONG_SCORE = 4;

export function meetsSixDimensionGate(scores: Partial<Record<DimensionId, number>>): {
  pass: boolean;
  reason: string;
} {
  const strong = (id: DimensionId) => (scores[id] ?? 0) >= STRONG_SCORE;
  if (!strong("structure")) return { pass: false, reason: "structure is not strong" };
  if (!strong("risk")) return { pass: false, reason: "risk is not strong" };
  const others = (["momentum", "confluence", "session", "track-record"] as DimensionId[]).filter(strong);
  if (others.length < 2) {
    return { pass: false, reason: `only ${others.length} of the other four dimensions are strong` };
  }
  return { pass: true, reason: "structure and risk strong, plus two or more others" };
}

/** Position size from the invalidation distance, never the other way round. */
export function positionSize(input: {
  accountBalance: number;
  riskPercent: number;
  entry: number;
  invalidation: number;
  valuePerPoint?: number;
}): { riskDollars: number; distance: number; units: number } | null {
  const distance = Math.abs(input.entry - input.invalidation);
  if (!(distance > 0) || !(input.accountBalance > 0) || !(input.riskPercent > 0)) return null;
  const riskDollars = (input.accountBalance * input.riskPercent) / 100;
  const perPoint = input.valuePerPoint && input.valuePerPoint > 0 ? input.valuePerPoint : 1;
  return {
    riskDollars: Math.round(riskDollars * 100) / 100,
    distance,
    units: Math.round((riskDollars / (distance * perPoint)) * 1e6) / 1e6,
  };
}

/** What a run of losses costs at a given risk percentage, for the survivability talk. */
export function drawdownAfterLosses(riskPercent: number, losses: number): number {
  const remaining = (1 - riskPercent / 100) ** Math.max(0, losses);
  return Math.round((1 - remaining) * 1000) / 10;
}

export const FOUNDATION_LESSONS = [
  {
    day: 1,
    id: "six-dimensions",
    title: "The six things that decide a trade",
    teach:
      "A setup that 'looks clean' is real pattern recognition and also where every bias hides. Score it instead, 1-5 on structure, momentum, risk, confluence, session and track record. Strong on structure and risk plus at least two others, or it is not a trade. Drill: score the trader's last trade from memory, then from the chart, and talk about the gap.",
  },
  {
    day: 2,
    id: "real-levels",
    title: "What makes a level real",
    teach:
      "A level is a price where something happened, not a line that was drawn. Weighted in order: reaction (one touch is coincidence, two is a level), volume (a level built in a dead session exists only on the screen), and time (a weekly level outranks a 15-minute level, always). Hence the cascade Weekly, Daily, 4H, 1H, 15m: the higher timeframe sets bias, the lower sets entry, and a 15-minute signal never overrides weekly structure. Price is always in accumulation, markup, distribution or markdown; most 'that level should have held' complaints are a distribution range traded as accumulation.",
  },
  {
    day: 3,
    id: "risk-first-sizing",
    title: "Risk before entry",
    teach:
      "Wrong order: setup, entry, target, size, stop wherever it fits. Right order: setup, invalidation, risk in dollars, size derived from the distance, then the target. The stop is the price at which the reason for the trade stops being true; the chart gives it. Size = (account x risk %) / distance to invalidation. Holding size constant and moving the stop is not a risk model, it is a mood. Pick a percentage that survives six losses in a row with a clear head: 1% leaves the account 6% down, 5% leaves it 26% down and needing a big trade, which is where revenge trading comes from.",
  },
  {
    day: 4,
    id: "breakout-retest",
    title: "Breakout and retest, one complete playbook",
    teach:
      "The trade is the retest, not the break. Preconditions: two or more prior reactions at the level, a break on expanding volume that closes beyond it rather than wicking, higher-timeframe bias agreeing, and a session where the instrument moves. Entry on the reaction to the retest, not the touch. Invalidation is a close back on the original side, a close and not a wick. Target the first structural level, bank there, trail the rest behind structure. It fails relentlessly in chop: if the structure was named a range, do not trade this pattern at all. Quote no win rate without sample size, date range and instrument.",
  },
  {
    day: 5,
    id: "chart-read-order",
    title: "Reading a chart in order",
    teach:
      "Weekly first: up, down or sideways, written down before anything smaller. Daily: mark three to five decision points with real reactions; fifteen lines means drawing, not finding. Name the state in one word, and call it transitioning when two fit. Find where volume disagrees with price, such as new highs on falling volume. Only then drop to 1H or 15m for the entry pattern, in the direction already given. Score the six dimensions and do nothing below an A.",
  },
  {
    day: 6,
    id: "discipline-is-state-dependent",
    title: "Why the framework is not enough",
    teach:
      "Traders who blow accounts can name exactly what they did, which is why more information never closes the gap. Discipline is state dependent and fails predictably: after a loss, after a win, and mid-trade when the stop slides for room and the target pulls in to be safe. When a bad habit gets paid, the brain files it as a good decision. What works is pre-commitment written down before entry, a hard daily loss limit with a physical action attached, and something outside the trader's own head, because in the moment they are not a reliable observer of themselves.",
  },
  {
    day: 7,
    id: "session-checklist",
    title: "The session checklist",
    teach:
      "Before the open: weekly and daily bias written down, three to five levels marked, structural state named, daily loss limit confirmed. On a setup: does it match a written playbook, score the six dimensions and skip below A, say invalidation, dollars at risk and target out loud, size from the invalidation distance. In the trade: the stop never moves against the position, and manage to the written plan rather than the chart. After: journal the six scores, the outcome, and one sentence on whether the plan was followed. Honest scoring is the step that fails first, because the trader is grading their own idea while wanting it to be good.",
  },
] as const;

export function foundationFrameworkForPrompt(): string {
  return [
    `# SEVEN-DAY FOUNDATION (${FOUNDATION_FRAMEWORK_VERSION}) - teaching material`,
    "This is the owner's own framework and the language it should be taught in. Use it to explain, drill and correct.",
    ...FOUNDATION_LESSONS.map((l) => `Day ${l.day} - ${l.title}: ${l.teach}`),
    `The six dimensions, in order: ${SIX_DIMENSIONS.map((d) => `${d.title} (${d.question})`).join(" ")}`,
    "Gate: strong on structure and risk plus at least two others, scored 1-5 with 4 or better counting as strong.",
    "Two hard limits. Never quote a win rate, expectancy or hit rate that the scoreboard cannot show with its sample size, date range and instruments. And none of this material overrides the computed bias, grade, entry, stop or target: it explains and drills, it does not decide.",
  ].join("\n");
}
