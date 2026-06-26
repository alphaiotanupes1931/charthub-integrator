// Map each coach personality to an ElevenLabs voice ID.
// Voice IDs from ElevenLabs default library.
export const COACH_VOICES: Record<string, { id: string; label: string; preview: string }> = {
  "The Analyst": {
    id: "JBFqnCBsd6RMkjVDRZzb", // George - calm, precise
    label: "George (precise, analytical)",
    preview:
      "Your edge today is asymmetric. London session XAU longs are running a sixty-eight percent win rate. Size up there, stand down elsewhere.",
  },
  "The Disciplinarian": {
    id: "bIHbv24MWmeRgasZH58o", // Will - firm, direct
    label: "Will (firm, accountable)",
    preview:
      "You broke your own rule on Tuesday. Two trades, no plan, both losers. We're not doing that again. Show me the setup, or stay out.",
  },
  "The Mentor": {
    id: "XrExE9yKIg1WjnnlVkGX", // Matilda - warm, patient
    label: "Matilda (warm, patient)",
    preview:
      "Take a breath. Markets give you a thousand chances a week, you only need to take the clean ones. Walk me through what you're seeing.",
  },
  "Generic AI Coach": {
    id: "EXAVITQu4vr4xnSDxMaL", // Sarah - neutral
    label: "Sarah (clear, neutral)",
    preview:
      "Welcome back. Want to review the chart, log a trade, or check your stats from the last week?",
  },
};

export function voiceForCoach(coach: string | undefined | null): string {
  if (coach && COACH_VOICES[coach]) return COACH_VOICES[coach].id;
  return COACH_VOICES["Generic AI Coach"].id;
}
