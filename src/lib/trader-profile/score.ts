import {
  type Answers, type CoachName, type CoachTone, type RiskDefaults, type TraderTypeId, type WeekTask,
  TIE_BREAK, TYPE_WEIGHTS, STRATEGY_SETS, RISK_CAUTIOUS, RISK_STANDARD, firstWeekFor, PROBLEMS, TRADER_TYPES,
} from "./config";

export type Recommendation = {
  type: TraderTypeId;
  typeName: string;
  coach: CoachName;
  coachReason: string;
  tone: CoachTone;
  strategies: string[];
  risk: RiskDefaults;
  week: WeekTask[];
  scores: Record<TraderTypeId, number>;
};

export function scoreTypes(a: Answers): Record<TraderTypeId, number> {
  const s: Record<TraderTypeId, number> = { comeback: 0, stop_mover: 0, gut: 0, second_guesser: 0, overtrader: 0, new_trader: 0 };
  for (const [key, table] of Object.entries(TYPE_WEIGHTS)) {
    const v = a[key as keyof Answers];
    const w = v ? table?.[v] : undefined;
    if (!w) continue;
    for (const [t, pts] of Object.entries(w)) s[t as TraderTypeId] += pts ?? 0;
  }
  return s;
}

export function pickType(a: Answers): TraderTypeId {
  const s = scoreTypes(a);
  let best: TraderTypeId = TIE_BREAK[0];
  let bestScore = -1;
  for (const t of TIE_BREAK) if (s[t] > bestScore) { best = t; bestScore = s[t]; }
  // New traders with no strong leak get the guided path.
  if (a.experience === "lt6m" && bestScore < 3) return "new_trader";
  if (bestScore <= 0) return a.experience === "lt6m" ? "new_trader" : "second_guesser";
  return best;
}

export function pickCoach(a: Answers, type: TraderTypeId): { coach: CoachName; reason: string } {
  const anxiety = Number(a.anxiety ?? 0);
  if (type === "comeback" || a.feel === "angry")
    return { coach: "The Disciplinarian", reason: "Losses pull you back in. You need someone who holds the line when you won't." };
  if (type === "overtrader" || (a.time === "most" && a.entry === "fomo"))
    return { coach: "The Minimalist", reason: "Fewer, better trades is your fastest win. This coach cuts the noise." };
  if (anxiety >= 7 || a.feel === "frozen" || type === "second_guesser")
    return { coach: "The Psychologist", reason: "Your rules are there; the pressure in the moment is the problem. This coach works on that." };
  if (a.experience === "lt6m" || type === "new_trader")
    return { coach: "The Mentor", reason: "You're early. This coach teaches the why behind every setup, patiently." };
  if (a.entry === "checklist" && a.rules === "exact")
    return { coach: "The Analyst", reason: "You trade from a checklist and want exact rules. This coach speaks in levels and data." };
  if (type === "stop_mover" || type === "gut")
    return { coach: "The Disciplinarian", reason: "Your exits and entries need firm rules. This coach enforces them." };
  return { coach: "The Analyst", reason: "A measured, data-first coach to keep your process sharp." };
}

export function pickTone(a: Answers): CoachTone {
  return a.feedback === "straight" || a.feedback === "encourage" ? a.feedback : "explain";
}

export function pickStrategies(a: Answers, type: TraderTypeId): string[] {
  if (type === "new_trader" || a.experience === "lt6m") return [...STRATEGY_SETS.new];
  if (a.market === "metals") return [...STRATEGY_SETS.metals];
  let base: string[];
  if (a.hold === "minutes" || a.time === "lt1") base = [...STRATEGY_SETS.scalp];
  else if (a.hold === "days") base = [...STRATEGY_SETS.swing];
  else base = [...STRATEGY_SETS.day];
  if (a.rules === "judgment" && a.miss_vs_bad === "miss") base = [base[0], ...STRATEGY_SETS.judgment];
  return base.slice(0, 2);
}

export function pickRisk(a: Answers, type: TraderTypeId): RiskDefaults {
  const anxious = Number(a.anxiety ?? 0) >= 7 || a.feel === "anxious";
  if (type === "new_trader" || type === "comeback" || a.experience === "lt6m" || anxious) return { ...RISK_CAUTIOUS };
  return { ...RISK_STANDARD };
}

export function recommend(a: Answers): Recommendation {
  const type = pickType(a);
  const { coach, reason } = pickCoach(a, type);
  return {
    type, typeName: TRADER_TYPES[type].name, coach, coachReason: reason, tone: pickTone(a),
    strategies: pickStrategies(a, type), risk: pickRisk(a, type), week: firstWeekFor(type), scores: scoreTypes(a),
  };
}

/** Turns the "I already know my problem" picks into regular answers. */
export function answersFromProblem(problem: string, extra: Answers): Answers {
  const p = PROBLEMS.find((x) => x.value === problem);
  return { ...extra, ...(p?.implies ?? {}) };
}
