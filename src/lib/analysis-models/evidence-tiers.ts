// Evidence tiers. The tier decides what a rule may do; a rule moves up only by
// a logged measurement (rule_evidence row), never by editing this file alone.
//   A: may block a trade    B: may adjust grade and size    C/D: recorded only

export type EvidenceTier = "A" | "B" | "C" | "D";
export type RuleAction = "block" | "grade" | "size" | "record";

export const TIER_ALLOWS: Record<EvidenceTier, readonly RuleAction[]> = {
  A: ["block", "grade", "size", "record"],
  B: ["grade", "size", "record"],
  C: ["record"],
  D: ["record"],
};

export type RuleId =
  | "entry.broken_level" | "entry.order_block" | "entry.imbalance" | "entry.retracement_618_79"
  | "context.fvg_presence" | "context.nesting_15m_in_1h" | "context.session_sequence";

export const RULE_TIERS: Record<RuleId, EvidenceTier> = {
  "entry.broken_level": "B",
  "entry.order_block": "C",
  "entry.imbalance": "C",
  "entry.retracement_618_79": "C",
  "context.fvg_presence": "C",
  "context.nesting_15m_in_1h": "D",
  "context.session_sequence": "D",
};

export function ruleMay(rule: RuleId, action: RuleAction): boolean {
  return TIER_ALLOWS[RULE_TIERS[rule]].includes(action);
}

/** Throws when code tries to use a rule beyond its tier. */
export function assertRuleMay(rule: RuleId, action: RuleAction): void {
  if (!ruleMay(rule, action)) throw new Error(`Rule ${rule} (tier ${RULE_TIERS[rule]}) may not ${action}.`);
}

export const RESEARCH_NON_NEGOTIABLES = [
  "One named hypothesis against one named null per run.",
  "Unfilled orders count as 0R and stay in the sample.",
  "Power check runs first; stop if the data cannot detect a decision-changing effect.",
  "Pooled result decides; minimum 30 per cell; 70/30 build vs held-out split.",
  "Risk held equal across candidates; costs included; same-bar stop and target counts as a stop.",
  "Every comparison run is logged with total R and average R.",
] as const;
