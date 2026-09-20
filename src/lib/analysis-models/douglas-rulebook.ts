// Model 4 ("Mark Douglas") rulebook: the ONLY knowledge this model is fed.
//
// Every rule below is distilled from the Mark Douglas "Mind Over the Market"
// interview (the trading-psychology material supplied by the owner). Nothing
// from TradeMind Classic, The Trading Channel, or Photon Trading is in scope.
//
// IMPORTANT — honest scope: this material is pure trading psychology. It
// contains NO chart mechanics: no entry patterns, no stop placement, no
// targets, no structure mapping. Inventing any of those and attributing them
// to Mark Douglas would be fabrication. So this model has a different job
// from the other three: it files NO trade signals of its own. It is the
// mindset model — it coaches the mental execution of whatever setup the
// trader's chart model produces. The deterministic engine
// (douglas-engine.ts) therefore produces a fixed execution-discipline read
// and always grades NO ENTRY; there is nothing to backtest because Douglas
// himself is explicit that the method supplies the edge and the mind
// supplies the consistency.

export const DOUGLAS_RULEBOOK_VERSION = "douglas-1.0";

export type DouglasRule = {
  /** Stable number the coach cites. */
  id: number;
  title: string;
  /** The principle, in Douglas's own terms. */
  rule: string;
};

export const DOUGLAS_RULEBOOK: readonly DouglasRule[] = [
  {
    id: 1,
    title: "The profit gap",
    rule:
      "There is almost always a gap between what a trader's method could have produced and what the trader actually took home. The gap is closed not by a better method but by mental skills: doing exactly what the method calls for, when it calls for it, without hesitation, reservation, or fear.",
  },
  {
    id: 2,
    title: "Winning is not consistent winning",
    rule:
      "Anyone can find themselves in a winning trade — winning requires no skill. Being a consistent winner is a completely different animal, and the two barely relate. Consistency is a mental skill, like a free-throw shooter who can hit 50 in a row in practice but chokes in the final: the method did not change, the state of mind did.",
  },
  {
    id: 3,
    title: "Outcomes are random and unique",
    rule:
      "The outcome of any single signal is random and unique, and there is a random distribution of wins and losses over any series of trades. An identical pattern on an identical-looking chart can lose this time after winning last time. No trade's outcome predicts the next one.",
  },
  {
    id: 4,
    title: "An edge is odds, not certainty",
    rule:
      "A technical method defines patterns in collective behaviour that put the odds of success in your favour over a SERIES of trades — nothing more. An edge is a higher probability of one thing happening over another, never a guarantee. This is the casino principle: random outcomes, consistent results.",
  },
  {
    id: 5,
    title: "Predefine the risk, every time",
    rule:
      "Before entering, decide exactly what you are willing to spend to find out whether other traders will come in and move the market your way. The method cannot force you to predefine risk, take the small loss, or keep the stop where it belongs — only discipline can.",
  },
  {
    id: 6,
    title: "Take every signal your edge produces",
    rule:
      "Because the sequence of wins and losses is unknowable, you must take every single trade your edge identifies. Picking and choosing based on how the last trade felt destroys the statistical advantage the method was built on.",
  },
  {
    id: 7,
    title: "The execution errors to eliminate",
    rule:
      "The classic mental errors: not predefining risk; refusing the small loss until it becomes a big one; moving the stop closer and getting clipped before the market goes your way; hesitating in too late; jumping the gun before the signal develops; exiting winners too early; letting a winner turn into a loser with no profit taken. Every one is a thinking error, not a method error.",
  },
  {
    id: 8,
    title: "Mechanical first, subjective later",
    rule:
      "Learn to execute mechanically — edge present, risk predefined, enter without analysing or judging — before ever allowing subjective discretion. Subjective trading before the mechanical stage is mastered is how accounts get hurt.",
  },
  {
    id: 9,
    title: "Expectation is the source of pain",
    rule:
      "Frustration comes from expecting the method to do something it cannot do — tell you what happens next on this trade. A losing trade means only that other traders did not share your conviction this time; it carries no information about you or the next trade. Guard especially against euphoria, the state where nothing can go wrong.",
  },
  {
    id: 10,
    title: "Think in probabilities",
    rule:
      "The consistent trader thinks in probabilities: anything can happen; you do not need to know what happens next to make money; there is a random distribution between wins and losses for any given set of variables; an edge is only an indication of higher probability; every moment in the market is unique.",
  },
];

export function douglasRuleCount(): number {
  return DOUGLAS_RULEBOOK.length;
}

/** The knowledge block the coach receives when this model is active. */
export function douglasRulebookForPrompt(): string {
  const rules = DOUGLAS_RULEBOOK.map((r) => `Rule ${r.id} — ${r.title}: ${r.rule}`).join("\n");
  return [
    `MARK DOUGLAS MODEL RULEBOOK (${DOUGLAS_RULEBOOK_VERSION}) — trading psychology only.`,
    "This model is fed ONLY the Mark Douglas material below. It has no chart mechanics by design: it files no trade signals, picks no direction, and places no entry, stop, or target. Its job is the mental execution of the setup the trader's chart model produced.",
    "Coach with it: when a trader hesitates, moves a stop, skips a valid signal, oversizes after a win, or spirals after a loss, name the rule being broken and coach the correction.",
    "",
    rules,
  ].join("\n");
}
