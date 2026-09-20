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
import { PHOTON_RULEBOOK, PHOTON_RULEBOOK_VERSION, photonRulebookForPrompt, photonRuleCount } from "./analysis-models/photon-rulebook";

export type AnalysisModelId = "classic" | "focus" | "photon";

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
  /** Where the material this model was fed comes from, shown behind the info button. */
  sourceUrl?: string;
  sourceLabel?: string;
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
    sourceUrl: "https://www.youtube.com/watch?v=eynxyoKgpng",
    sourceLabel: "Watch the Trading Channel material this model was fed",
    ready: focusRuleCount() > 0,
    notReadyReason:
      "This model has no strategies written into it yet, so it cannot grade setups or file signals. Send the strategies and they get written into its rulebook.",
  },
  {
    id: "photon",
    name: "Photon Trading",
    version: `photon-1.0 (${PHOTON_RULEBOOK_VERSION})`,
    tagline: "Fed only Photon Trading's mechanical market-structure mapping: swing breaks on closes, internal shifts on wicks, target weak structure.",
    description:
      "A clean-slate model fed only Photon Trading's mechanical market-structure material — nothing from TradeMind Classic or The Trading Channel leaks in. It maps the swing range from candle wicks (the swing low is the lowest point that caused the swing high, and everything in between is internal structure, not trend), takes direction only from a candle CLOSE through a swing level so liquidity grabs don't count as breaks, and after every break of structure it expects the pullback instead of chasing it. Internal changes of character on simple wick breaks time the pullback: the counter-trend shift says the pullback has started, the shift back in line with the swing trend says it has finished, and that realignment is the entry. Stops hide beyond the protecting swing — the level a lot of money had to defend — and targets aim at weak structure: the high that failed to make a lower low, or the low that failed to make a higher high, paying at least 1.5R. Reversal anticipation and supply/demand refinement are taught as coach knowledge but never auto-traded, and the model never issues A+ in v1. Every signal it files is stamped with its own name and version and tracked on its own scoreboard, so you can judge this methodology on its own numbers before trusting it.",
    knowledge: "strategies-only",
    sourceUrl: "https://www.youtube.com/watch?v=Pd9ASRCHWmQ",
    sourceLabel: "Watch the Photon Trading material this model was fed",
    ready: photonRuleCount() > 0,
    notReadyReason:
      "This model has no strategies written into it yet, so it cannot grade setups or file signals. Send the strategies and they get written into its rulebook.",
  },
];

export function normalizeAnalysisModel(raw: unknown): AnalysisModelId {
  return raw === "focus" || raw === "photon" ? raw : DEFAULT_ANALYSIS_MODEL;
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
/** The rulebook each strategies-only model is fed. */
function rulebookFor(id: AnalysisModelId): { count: number; text: string } {
  if (id === "photon") {
    return { count: photonRuleCount(), text: photonRuleCount() > 0 ? photonRulebookForPrompt() : "" };
  }
  return { count: focusRuleCount(), text: focusRuleCount() > 0 ? focusRulebookForPrompt() : "" };
}

export function analysisModelPromptBlock(id: unknown): string {
  const model = getAnalysisModel(id);
  if (model.knowledge === "full") return "";
  const rulebook = rulebookFor(model.id);
  const body = rulebook.count > 0 ? rulebook.text : "(No strategies have been written into this model yet.)";
  return [
    `# ACTIVE ANALYSIS MODEL: ${model.name} (${model.version})`,
    "This model is fed ONLY the strategies listed below. Every other pattern library, preset, or habit from the standard TradeMind model is OUT OF SCOPE for this conversation. Do not grade, plan, or justify a setup using a rule that is not written below.",
    "If the trader asks for something these strategies do not cover, say plainly that this model does not cover it and name what it does cover. Do not improvise a rule.",
    "",
    body,
    rulebook.count > 0
      ? ""
      : "Until strategies are added, do not produce entries, stops, targets, or grades in this model. Explain that the model is empty and offer to answer in TradeMind Classic instead.",
  ]
    .filter(Boolean)
    .join("\n");
}

export { FOCUS_RULEBOOK, FOCUS_RULEBOOK_VERSION, PHOTON_RULEBOOK, PHOTON_RULEBOOK_VERSION };
