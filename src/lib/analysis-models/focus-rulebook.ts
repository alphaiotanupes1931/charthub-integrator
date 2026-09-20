// Model 2 ("TradeMind Focus") rulebook: the ONLY knowledge this model is fed.
//
// Same shape as the Wyckoff rulebook: versioned, written down, and deterministic
// in intent. The AI is never allowed to decide direction, entry, stop, target or
// grade from it; code checks the rules and the AI narrates the result.
//
// The list is intentionally empty until the owner supplies the strategies. An
// empty rulebook makes the model visibly empty rather than quietly falling back
// to Classic behaviour.

export const FOCUS_RULEBOOK_VERSION = "focus-rulebook-0.0-empty";

export type FocusRule = {
  /** Stable number the coach and the engine both cite. */
  id: number;
  title: string;
  /** What must be true, in testable terms. */
  rule: string;
  /** What voids the setup. */
  invalidates?: string;
};

export const FOCUS_RULEBOOK: readonly FocusRule[] = [];

export function focusRuleCount(): number {
  return FOCUS_RULEBOOK.length;
}

/** Serialised rulebook for the coach's system prompt. */
export function focusRulebookForPrompt(): string {
  if (FOCUS_RULEBOOK.length === 0) return "(No strategies have been written into this model yet.)";
  const lines = FOCUS_RULEBOOK.map((r) =>
    [`Rule ${r.id} - ${r.title}: ${r.rule}`, r.invalidates ? `  Voided when: ${r.invalidates}` : null]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `RULEBOOK ${FOCUS_RULEBOOK_VERSION} (${FOCUS_RULEBOOK.length} rules, persistent across sessions):`,
    ...lines,
    "You may not add, relax, or reinterpret a rule. Direction, entry, stop, target and grade are computed in code, never by you.",
  ].join("\n");
}
