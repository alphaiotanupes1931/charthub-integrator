// Named, switchable analysis models.
//
// A model is defined purely by WHAT IT IS FED: which strategy knowledge the
// coach receives and which rules the deterministic code checks. Direction,
// entry, stop, target and grade still come from code in every model; the AI
// narrates. Switching a model never changes that boundary.
//
// Model 1 ("TradeMind Classic") is exactly the content the platform has been
// fed to date, given a name and a version so results can be attributed to it.
// Model 2 ("The Trading Channel") is fed only the strategies the owner supplies; it
// deliberately inherits nothing from Classic, so its record can be judged on
// its own.

import { FOCUS_RULEBOOK, FOCUS_RULEBOOK_VERSION, focusRulebookForPrompt, focusRuleCount } from "./analysis-models/focus-rulebook";

export type AnalysisModelId = "classic" | "focus";

export type AnalysisModel = {
  id: AnalysisModelId;
  /** Shown in the picker. */
  name: string;
  /** Stamped on every scan and filed signal. */
  version: string;
  /** One line the trader reads in the picker. */
  tagline: string;
  /** Full explanation behind the picker's info button: what the model is fed and what makes it different. */
  description: string;
  /**
   * "full" = everything the platform knows (Classic).
   * "strategies-only" = nothing but the supplied rulebook (Focus).
   */
  knowledge: "full" | "strategies-only";
  /** False while the model has no strategies written into it yet. */
  ready: boolean;
  /** Plain-language reason shown when the model cannot produce signals. */
  notReadyReason?: string;
};

export const DEFAULT_ANALYSIS_MODEL: AnalysisModelId = "classic";

export const ANALYSIS_MODELS: readonly AnalysisModel[] = [
  {
    id: "classic",
    name: "TradeMind Classic",
    version: "classic-1.0",
    tagline: "The full library: order blocks, protected structure, per-market behaviour, journal and news.",
    description:
      "The original TradeMind model — everything the platform has been fed since day one. It reads multi-timeframe order-block cascades (1H order blocks, 15m confirmation, 5m refinement), protected break-of-structure with liquidity sweeps, fair value gaps, per-market sessions and grade ceilings, the economic calendar, and your own journal history. Every signal it has ever filed lives on the public record under this name, so its track record is the platform's track record.",
    knowledge: "full",
    ready: true,
  },
  {
    id: "focus",
    name: "The Trading Channel",
    version: `focus-1.0 (${FOCUS_RULEBOOK_VERSION})`,
    tagline: "Fed only The Trading Channel strategies: objective trend, break and retest, pressure candles, ATR stops.",
    description:
      "A clean-slate model fed only The Trading Channel's technical-analysis material — nothing from Classic leaks in. It reads trend objectively (an impulsive close through a swing point, alive until the pullback's origin gives way), enters on the break-and-retest of the level that was just broken, and demands a pressure candle at the zone: a 38.2 candle, an engulfing candle, or a close beyond the previous candle's extreme. Stops sit one ATR(14) beyond the protecting swing, targets come from structure and must pay at least 1.5R, and continuation trades must ride the 20-period moving average. Double tops and bottoms, flags and wedges, and RSI divergence are taught as coach knowledge but are never traded on an indicator alone. It knows nothing about order blocks, fair value gaps, or any other TradeMind Classic library. Every signal it files is stamped with its own name and version and tracked on its own scoreboard, so you can judge these strategies on their own numbers before trusting them.",
    knowledge: "strategies-only",
    ready: focusRuleCount() > 0,
    notReadyReason:
      "This model has no strategies written into it yet, so it cannot grade setups or file signals. Send the strategies and they get written into its rulebook.",
  },
];

export function normalizeAnalysisModel(raw: unknown): AnalysisModelId {
  return raw === "focus" ? "focus" : DEFAULT_ANALYSIS_MODEL;
}

export function getAnalysisModel(id: unknown): AnalysisModel {
  const wanted = normalizeAnalysisModel(id);
  return ANALYSIS_MODELS.find((m) => m.id === wanted) ?? ANALYSIS_MODELS[0]!;
}

export function analysisModelVersion(id: unknown): string {
  return getAnalysisModel(id).version;
}

/** True when this model may grade setups and file signals. */
export function analysisModelReady(id: unknown): boolean {
  return getAnalysisModel(id).ready;
}

/**
 * The knowledge block for the coach's system prompt.
 *
 * Classic returns an empty string, because the Classic knowledge is already the
 * static prompt the platform has always sent; keeping it untouched is what makes
 * Model 1 a rename rather than a behaviour change. Focus returns its own
 * rulebook plus an explicit instruction that nothing else applies.
 */
export function analysisModelPromptBlock(id: unknown): string {
  const model = getAnalysisModel(id);
  if (model.knowledge === "full") return "";
  const body = focusRuleCount() > 0 ? focusRulebookForPrompt() : "(No strategies have been written into this model yet.)";
  return [
    `# ACTIVE ANALYSIS MODEL: ${model.name} (${model.version})`,
    "This model is fed ONLY the strategies listed below. Every other pattern library, preset, or habit from the standard TradeMind model is OUT OF SCOPE for this conversation. Do not grade, plan, or justify a setup using a rule that is not written below.",
    "If the trader asks for something these strategies do not cover, say plainly that this model does not cover it and name what it does cover. Do not improvise a rule.",
    "",
    body,
    focusRuleCount() > 0
      ? ""
      : "Until strategies are added, do not produce entries, stops, targets, or grades in this model. Explain that the model is empty and offer to answer in TradeMind Classic instead.",
  ]
    .filter(Boolean)
    .join("\n");
}

export { FOCUS_RULEBOOK, FOCUS_RULEBOOK_VERSION };
