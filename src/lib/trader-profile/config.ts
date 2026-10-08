/**
 * Trader profile rules. Every question, type write-up and mapping lives here so
 * the wording and the scoring can be tuned without touching the screens.
 */

export type Option = { value: string; label: string };
export type Question = { key: AnswerKey; prompt: string; group: "trade" | "self"; options: Option[] };

export type AnswerKey =
  | "market" | "hold" | "time" | "session" | "experience" | "entry" | "stop"
  | "after_loss" | "leak" | "feel" | "miss_vs_bad" | "rules" | "feedback" | "anxiety";

export type Answers = Partial<Record<AnswerKey, string>>;

export const QUESTIONS: Question[] = [
  { key: "market", group: "trade", prompt: "What do you mostly trade?", options: [
    { value: "metals", label: "Gold / metals" }, { value: "forex", label: "Forex" }, { value: "indices", label: "Indices" },
    { value: "futures", label: "Futures" }, { value: "crypto", label: "Crypto" }, { value: "stocks", label: "Stocks / options" } ] },
  { key: "hold", group: "trade", prompt: "How long are you usually in a trade?", options: [
    { value: "minutes", label: "Minutes" }, { value: "hours", label: "Hours" }, { value: "days", label: "Days or more" }, { value: "varies", label: "It changes" } ] },
  { key: "time", group: "trade", prompt: "How much time can you give trading on a normal day?", options: [
    { value: "lt1", label: "Under 1 hour" }, { value: "1to3", label: "1 to 3 hours" }, { value: "most", label: "Most of the day" } ] },
  { key: "session", group: "trade", prompt: "Which session do you trade?", options: [
    { value: "asia", label: "Asia" }, { value: "london", label: "London" }, { value: "newyork", label: "New York" }, { value: "any", label: "Whenever I can" } ] },
  { key: "experience", group: "trade", prompt: "How long have you been trading?", options: [
    { value: "lt6m", label: "Under 6 months" }, { value: "6to24m", label: "6 to 24 months" }, { value: "2to5y", label: "2 to 5 years" }, { value: "5y", label: "5+ years" } ] },
  { key: "entry", group: "trade", prompt: "What actually makes you enter?", options: [
    { value: "checklist", label: "My checklist" }, { value: "feel", label: "The chart feels right" },
    { value: "signal", label: "Someone else's signal" }, { value: "fomo", label: "It's moving and I don't want to miss it" } ] },
  { key: "stop", group: "trade", prompt: "What happens to your stop once you're in?", options: [
    { value: "never", label: "Never touch it" }, { value: "move", label: "Move it when price gets close" },
    { value: "mental", label: "Mental stop" }, { value: "none", label: "Don't always use one" } ] },
  { key: "after_loss", group: "trade", prompt: "Right after a loss you usually...", options: [
    { value: "stop_day", label: "Stop for the day" }, { value: "wait", label: "Wait for the next real setup" },
    { value: "revenge", label: "Jump back in to win it back" }, { value: "bigger", label: "Go bigger" } ] },
  { key: "leak", group: "trade", prompt: "What costs you the most money?", options: [
    { value: "bad_setups", label: "Bad setups" }, { value: "stops", label: "Moving stops" }, { value: "revenge", label: "Revenge trading" },
    { value: "size", label: "Trading too big" }, { value: "early", label: "Closing winners early" },
    { value: "skip", label: "Not taking the trade" }, { value: "overtrading", label: "Overtrading" } ] },
  { key: "feel", group: "self", prompt: "When a trade goes against you, what do you feel first?", options: [
    { value: "calm", label: "Calm, it's part of it" }, { value: "anxious", label: "Anxious" }, { value: "angry", label: "Angry" }, { value: "frozen", label: "Frozen" } ] },
  { key: "miss_vs_bad", group: "self", prompt: "Which sounds more like you?", options: [
    { value: "miss", label: "I'd rather miss a trade than take a bad one" }, { value: "take_bad", label: "I'd rather take a bad trade than miss a good one" } ] },
  { key: "rules", group: "self", prompt: "Do you prefer clear rules or reading the situation?", options: [
    { value: "exact", label: "Give me exact rules" }, { value: "judgment", label: "I like to use judgment" } ] },
  { key: "feedback", group: "self", prompt: "How do you like to be told you're wrong?", options: [
    { value: "straight", label: "Straight, no sugar-coating" }, { value: "explain", label: "Explain the why" }, { value: "encourage", label: "Encourage me" } ] },
  { key: "anxiety", group: "self", prompt: "On a scale of 1 to 10, how anxious are you while a trade is open?", options:
    Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })) },
];

/** "I already know my problem" path: three screens. */
export const PROBLEMS: Array<Option & { implies: Answers }> = [
  { value: "revenge", label: "I revenge trade", implies: { after_loss: "revenge", leak: "revenge", feel: "angry" } },
  { value: "stops", label: "I move my stop", implies: { stop: "move", leak: "stops" } },
  { value: "overtrade", label: "I overtrade", implies: { leak: "overtrading", time: "most", entry: "fomo" } },
  { value: "freeze", label: "I freeze and don't take trades", implies: { leak: "skip", feel: "frozen", miss_vs_bad: "miss" } },
  { value: "new", label: "I'm brand new", implies: { experience: "lt6m" } },
];
export const QUICK_KEYS: AnswerKey[] = ["market", "hold"];

export type TraderTypeId = "comeback" | "stop_mover" | "gut" | "second_guesser" | "overtrader" | "new_trader";

export const TRADER_TYPES: Record<TraderTypeId, { name: string; short: string; read: string }> = {
  comeback: { name: "The Comeback Trader", short: "Losses pull you back in.",
    read: "You don't fear losing, you hate it. After a red trade the urge is to win it back straight away, often bigger. That one habit can undo a month of good trading in an afternoon." },
  stop_mover: { name: "The Stop Mover", short: "Your stop is a suggestion.",
    read: "Your entries are often fine. The damage happens after: the stop gets moved, kept in your head, or skipped. Small losses turn into big ones because the exit was never fixed." },
  gut: { name: "The Gut Trader", short: "You trade what you feel.",
    read: "You enter on feel, momentum or someone else's call. Sometimes it works, which makes it hard to stop. Without a written reason to enter, you can't tell a good trade from a lucky one." },
  second_guesser: { name: "The Second-Guesser", short: "Good rules, shaky follow-through.",
    read: "You know what a good setup looks like, then hesitate. You skip valid trades or grab profit too early. The edge is there; confidence in it is what's missing." },
  overtrader: { name: "The Overtrader", short: "More trades, less edge.",
    read: "You're at the screen a lot and it shows in your trade count. Many of those trades are boredom or fear of missing out, and the costs quietly eat the good ones." },
  new_trader: { name: "The New Trader", short: "Fresh start, no bad habits yet.",
    read: "You're early, which is an advantage: no habits to unlearn. The goal right now is a simple process, small size and learning what a good setup actually looks like." },
};

/** Habits that blow accounts win ties, in this order. */
export const TIE_BREAK: TraderTypeId[] = ["comeback", "stop_mover", "gut", "second_guesser", "overtrader"];

/** Points per answer. Score = sum over answers. */
export const TYPE_WEIGHTS: Partial<Record<AnswerKey, Record<string, Partial<Record<TraderTypeId, number>>>>> = {
  after_loss: { revenge: { comeback: 3 }, bigger: { comeback: 3 } },
  leak: { revenge: { comeback: 3 }, size: { comeback: 3 }, stops: { stop_mover: 3 }, early: { second_guesser: 3 },
    skip: { second_guesser: 3 }, overtrading: { overtrader: 3 }, bad_setups: { gut: 1 } },
  stop: { move: { stop_mover: 3 }, mental: { stop_mover: 2 }, none: { stop_mover: 3 } },
  entry: { feel: { gut: 3 }, signal: { gut: 3 }, fomo: { gut: 2, overtrader: 1 }, checklist: { second_guesser: 1 } },
  feel: { angry: { comeback: 1 }, frozen: { second_guesser: 2 } },
  miss_vs_bad: { take_bad: { gut: 1 }, miss: { second_guesser: 1 } },
  rules: { judgment: { gut: 1 } },
  time: { most: { overtrader: 1 } },
};

export const COACHES = ["The Analyst", "The Disciplinarian", "The Mentor", "The Minimalist", "The Psychologist"] as const;
export type CoachName = (typeof COACHES)[number];

export type CoachTone = "straight" | "explain" | "encourage";
export const TONE_LABEL: Record<CoachTone, string> = {
  straight: "Straight, no sugar-coating", explain: "Explains the why", encourage: "Encouraging",
};

export const STRATEGY_SETS = {
  new: ["Breakout & Retest"],
  scalp: ["VWAP Trading", "Breakout & Retest"],
  day: ["Supply & Demand Zones", "ICT Concepts"],
  swing: ["Fibonacci Retracement", "EMA Crossover Trend"],
  judgment: ["Mean Reversion (Bollinger)"],
  /** Metals are the weakest instruments on signal accuracy; keep to the simplest playbooks until confirmed. */
  metals: ["Breakout & Retest", "Supply & Demand Zones"],
} as const;

export type RiskDefaults = { riskPct: number; maxDailyLossPct: number; minGrade: "A" | "B+" };
export const RISK_CAUTIOUS: RiskDefaults = { riskPct: 0.5, maxDailyLossPct: 2, minGrade: "A" };
export const RISK_STANDARD: RiskDefaults = { riskPct: 1, maxDailyLossPct: 3, minGrade: "B+" };

export type WeekTask = { day: number; label: string; route: string };
const BASE_WEEK: WeekTask[] = [
  { day: 1, label: "Grade one setup on the dashboard", route: "/dashboard" },
  { day: 2, label: "Log one trade in your journal", route: "/journal" },
  { day: 3, label: "Watch one Academy lesson", route: "/academy" },
  { day: 4, label: "", route: "" },
  { day: 5, label: "Review your week with your coach", route: "/chat" },
];
export const DAY4_BY_TYPE: Record<TraderTypeId, WeekTask> = {
  comeback: { day: 4, label: "Set your max daily loss and stop after it", route: "/calculator" },
  stop_mover: { day: 4, label: "Place one trade with a hard stop you don't touch", route: "/journal" },
  gut: { day: 4, label: "Write a 3-line entry checklist for your strategy", route: "/strategies" },
  second_guesser: { day: 4, label: "Take one A-grade setup at full plan, no early exit", route: "/signals" },
  overtrader: { day: 4, label: "Trade one session only, max two trades", route: "/dashboard" },
  new_trader: { day: 4, label: "Practise sizing with the risk calculator", route: "/calculator" },
};
export function firstWeekFor(type: TraderTypeId): WeekTask[] {
  return BASE_WEEK.map((t) => (t.day === 4 ? DAY4_BY_TYPE[type] : t));
}
