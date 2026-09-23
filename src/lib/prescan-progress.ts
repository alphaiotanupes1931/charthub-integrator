// One-question-per-scan progression for the pre-scan check.
//
// Everyone starts at Beginner. Each scan asks exactly one question. A question
// the trader has already answered correctly is never asked again; a question
// they got wrong can come back later. After enough distinct correct answers at
// a level (or once that level has nothing left to ask) they move up.

import type { AnalysisModelId } from "@/lib/analysis-models";
import { preScanQuestionBank, type PreScanQuestion } from "@/lib/prescan-questions";

export type PreScanLevel = "beginner" | "intermediate" | "advanced";
export const LEVELS: PreScanLevel[] = ["beginner", "intermediate", "advanced"];
export const LEVEL_LABEL: Record<PreScanLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};
/** Distinct correct answers needed at a level before moving up. */
export const PROMOTE_AFTER: Record<PreScanLevel, number> = {
  beginner: 5,
  intermediate: 5,
  advanced: Infinity,
};

export type LeveledQuestion = PreScanQuestion & { level: PreScanLevel };
export type Attempt = { question_id: string; correct: boolean; created_at?: string };

const BEGINNER: PreScanQuestion[] = [
  {
    id: "beg-support",
    question: "What is a support level?",
    options: [
      "A price where buyers have stepped in before and stopped price falling",
      "The highest price of the day",
      "A level your broker guarantees",
      "Any round number",
    ],
    correct: 0,
    why: "Support is a floor where demand showed up before. It is a zone to watch, not a promise that price will bounce.",
  },
  {
    id: "beg-resistance",
    question: "What is a resistance level?",
    options: [
      "A price where sellers have stepped in before and capped the move up",
      "The price you bought at",
      "A level that can never break",
      "The daily open",
    ],
    correct: 0,
    why: "Resistance is a ceiling where supply showed up before. When it breaks and holds, it often turns into support.",
  },
  {
    id: "beg-stop",
    question: "What is a stop loss for?",
    options: [
      "To make the trade win more often",
      "To cap how much you lose if the idea is wrong",
      "To lock in profit automatically",
      "Only professionals need one",
    ],
    correct: 1,
    why: "The stop is the price that says you were wrong. It keeps one bad trade from wiping out many good ones.",
  },
  {
    id: "beg-rr",
    question: "A trade risks 20 points to make 40 points. What is the reward-to-risk?",
    options: ["0.5R", "1R", "2R", "4R"],
    correct: 2,
    why: "Reward divided by risk: 40 / 20 = 2. You make twice what you risk if it works.",
  },
  {
    id: "beg-risk-pct",
    question: "What is a sensible amount of your account to risk on one trade while learning?",
    options: ["About 1%", "About 10%", "Half the account", "Whatever the setup deserves"],
    correct: 0,
    why: "Small, fixed risk keeps you in the game through losing streaks, which every strategy has.",
  },
  {
    id: "beg-trend",
    question: "Price keeps making higher highs and higher lows. What is the trend?",
    options: ["Down", "Up", "Sideways", "You cannot tell"],
    correct: 1,
    why: "Higher highs and higher lows is the definition of an uptrend. Lower highs and lower lows is a downtrend.",
  },
  {
    id: "beg-candle",
    question: "A candle closes higher than it opened. What does that candle show?",
    options: [
      "Sellers controlled that period",
      "Buyers controlled that period",
      "Nothing, colour does not matter",
      "The trend has reversed",
    ],
    correct: 1,
    why: "A close above the open means buyers won that period. One candle alone does not change the trend.",
  },
  {
    id: "beg-spread",
    question: "What is the spread?",
    options: [
      "The gap between the buy price and the sell price",
      "Your profit on the trade",
      "The distance to your stop",
      "The daily range",
    ],
    correct: 0,
    why: "The spread is a cost you pay on every trade. It widens around news, which is why entries there are expensive.",
  },
];

/** Level assignment for the existing shared and model banks. */
const LEVEL_OF: Record<string, PreScanLevel> = {
  "shared-closed": "beginner",
  "shared-noentry": "beginner",
  "shared-invalidation": "intermediate",
  "shared-htf": "intermediate",
  "shared-nonews": "intermediate",
};

/** Full leveled bank for a model. Model-specific questions: first two intermediate, rest advanced. */
export function leveledBank(modelId: AnalysisModelId): LeveledQuestion[] {
  const bank = preScanQuestionBank(modelId);
  const modelQs = bank.filter((q) => !q.id.startsWith("shared-"));
  const out: LeveledQuestion[] = BEGINNER.map((q) => ({ ...q, level: "beginner" as const }));
  for (const q of bank) {
    if (LEVEL_OF[q.id]) out.push({ ...q, level: LEVEL_OF[q.id] });
  }
  modelQs.forEach((q, i) => out.push({ ...q, level: i < 2 ? "intermediate" : "advanced" }));
  return out;
}

export function masteredIds(attempts: Attempt[]): Set<string> {
  return new Set(attempts.filter((a) => a.correct).map((a) => a.question_id));
}

/**
 * Current level: the first level where the trader has not yet reached the
 * promotion count AND still has unmastered questions left. Levels are
 * judged across every model's bank so switching models never demotes anyone.
 */
export function currentLevel(attempts: Attempt[], bank: LeveledQuestion[]): PreScanLevel {
  const mastered = masteredIds(attempts);
  for (const level of LEVELS) {
    const atLevel = bank.filter((q) => q.level === level);
    const correct = atLevel.filter((q) => mastered.has(q.id)).length;
    const remaining = atLevel.length - correct;
    if (correct < PROMOTE_AFTER[level] && remaining > 0) return level;
  }
  return "advanced";
}

export type Progress = {
  level: PreScanLevel;
  correctAtLevel: number;
  neededAtLevel: number;
  totalCorrect: number;
};

export function progressFor(attempts: Attempt[], bank: LeveledQuestion[]): Progress {
  const level = currentLevel(attempts, bank);
  const mastered = masteredIds(attempts);
  const atLevel = bank.filter((q) => q.level === level);
  const correctAtLevel = atLevel.filter((q) => mastered.has(q.id)).length;
  const need = PROMOTE_AFTER[level];
  return {
    level,
    correctAtLevel,
    neededAtLevel: Number.isFinite(need) ? Math.min(need, atLevel.length) : atLevel.length,
    totalCorrect: mastered.size,
  };
}

/**
 * Next question for this trader. Never a mastered one. Prefers questions they
 * have never seen, then the one they got wrong longest ago. Returns null when
 * every question in the bank is mastered.
 */
export function pickNextQuestion(
  attempts: Attempt[],
  bank: LeveledQuestion[],
  seed = Date.now(),
): LeveledQuestion | null {
  const mastered = masteredIds(attempts);
  const start = LEVELS.indexOf(currentLevel(attempts, bank));
  const lastSeen = new Map<string, number>();
  attempts.forEach((a, i) => {
    const t = a.created_at ? Date.parse(a.created_at) : i;
    lastSeen.set(a.question_id, Math.max(lastSeen.get(a.question_id) ?? -Infinity, t));
  });
  // Current level first, then higher, then any lower ones still unmastered.
  const order = [...LEVELS.slice(start), ...LEVELS.slice(0, start).reverse()];
  for (const lvl of order) {
    const open = bank.filter((q) => q.level === lvl && !mastered.has(q.id));
    if (!open.length) continue;
    const unseen = open.filter((q) => !lastSeen.has(q.id));
    if (unseen.length) return unseen[Math.abs(Math.floor(seed / 1000)) % unseen.length];
    return [...open].sort((a, b) => (lastSeen.get(a.id)! - lastSeen.get(b.id)!))[0];
  }
  return null;
}
