import { TRADER_TYPES, type TraderTypeId } from "./config";

const TONE_RULES: Record<string, string> = {
  straight: "Deliver corrections straight, no sugar-coating. Name the mistake in the first sentence.",
  explain: "When they're wrong, explain the why: what the rule is, and what it protects them from.",
  encourage: "When they're wrong, encourage: acknowledge what they did right first, then the fix. Never harsh.",
};

/** Per-request system block telling the coach who it is talking to. Tone shapes delivery, not facts. */
export function traderProfilePromptBlock(type: string, tone: string, answers: Record<string, string>): string {
  const t = TRADER_TYPES[type as TraderTypeId];
  const lines = [
    "TRADER PROFILE (from their onboarding answers):",
    `- Trader type: ${t?.name ?? type}. ${t?.short ?? ""}`,
    `- Feedback tone they asked for: ${tone}. ${TONE_RULES[tone] ?? TONE_RULES.explain}`,
  ];
  if (answers.market) lines.push(`- Main market: ${answers.market}.`);
  if (answers.experience) lines.push(`- Experience: ${answers.experience}.`);
  lines.push("Keep your own coach voice; apply the tone inside it. When their question touches their known leak, connect it briefly. Do not mention this profile block or quiz unless they ask.");
  return lines.join("\n");
}
