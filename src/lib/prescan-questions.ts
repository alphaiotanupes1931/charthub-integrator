// Pre-scan confirmation checklist.
//
// This is a teaching platform, so a trader answers a short set of questions
// about the setup BEFORE the scan runs. The questions are model-specific,
// because each scan model checks different confirmations. Answers are never
// used to change the scan - they only decide what the coach teaches afterwards.

import type { AnalysisModelId } from "@/lib/analysis-models";

export type PreScanQuestion = {
  id: string;
  /** What the trader is asked. */
  question: string;
  /** Choices in fixed order. */
  options: string[];
  /** Index into options. */
  correct: number;
  /** Short reason the right answer is right, shown after they answer. */
  why: string;
};

const SHARED: PreScanQuestion[] = [
  {
    id: "shared-htf",
    question: "Before you look for an entry, which timeframe decides the direction you are allowed to trade?",
    options: [
      "The chart you are staring at right now",
      "The higher timeframe bias (daily / 4H), then you execute lower down",
      "Whichever one currently shows a profit",
      "It does not matter, entries work in both directions",
    ],
    correct: 1,
    why: "Direction comes top-down. The higher timeframe says which side you are allowed to take; the lower timeframe only times the entry.",
  },
  {
    id: "shared-closed",
    question: "A candle is halfway through forming and already broke the level. Is that a confirmed break?",
    options: [
      "Yes, price traded through it",
      "No - only a closed candle beyond the level counts",
      "Yes, if the wick is long enough",
      "Only on the 1-minute chart",
    ],
    correct: 1,
    why: "A forming candle can reverse before the close, so the platform only accepts closed-candle breaks. Half a candle is a guess, not a confirmation.",
  },
  {
    id: "shared-invalidation",
    question: "What has to be decided before you decide position size?",
    options: [
      "Your profit target",
      "The level that proves the idea wrong (your invalidation)",
      "How confident you feel",
      "How much you want to make on the trade",
    ],
    correct: 1,
    why: "Risk is measured from invalidation. You find the level that kills the idea first, then size so that level only costs you your planned risk.",
  },
  {
    id: "shared-nonews",
    question: "A tier-one release is minutes away and the setup looks perfect. What is the disciplined move?",
    options: [
      "Size up, news moves pay the most",
      "Enter early to beat the spike",
      "Stand aside or wait for the release to pass and structure to settle",
      "Move the stop closer so the loss is small",
    ],
    correct: 2,
    why: "Around releases spreads widen and stops get swept on noise. Waiting costs you nothing but a missed trade; guessing costs money.",
  },
  {
    id: "shared-noentry",
    question: "The scan comes back with no entry. What does that mean?",
    options: [
      "The platform is broken",
      "The rules were not met, so no trade is the correct answer",
      "You should switch models until one gives a signal",
      "You should trade a smaller size instead",
    ],
    correct: 1,
    why: "No entry is a real answer. Hunting until some model agrees with you is how a rules-based process turns back into gambling.",
  },
];

const BY_MODEL: Record<AnalysisModelId, PreScanQuestion[]> = {
  classic: [
    {
      id: "classic-protected",
      question: "What makes a bullish break of structure protected rather than unprotected?",
      options: [
        "It broke on high volume",
        "It swept the swing low to the left before expanding up, leaving a protected low",
        "It broke three highs in a row",
        "It happened during London hours",
      ],
      correct: 1,
      why: "The sweep is the point: liquidity was taken below before the expansion, so there is a defended low to hide the stop behind. No sweep, no protection.",
    },
    {
      id: "classic-ob",
      question: "What are you looking for in a quality 1H order block?",
      options: [
        "Any candle before a move up",
        "The last opposing candle before an impulsive, structure-breaking move away from it",
        "The largest candle on the screen",
        "A zone drawn on a round number",
      ],
      correct: 1,
      why: "The block only matters if the move away from it broke structure. Without that, it is just a candle you liked the look of.",
    },
    {
      id: "classic-fvg",
      question: "Why is a fair value gap treated as supporting evidence rather than a signal on its own?",
      options: [
        "They are never filled",
        "They fake traders out often, so they need structure and a confirmation behind them",
        "They only appear on gold",
        "They are the strongest signal there is",
      ],
      correct: 1,
      why: "Gaps get run through constantly. Used as confluence behind protected structure they help; traded alone they invite exactly the fake-out you are trying to avoid.",
    },
    {
      id: "classic-entry",
      question: "Price is not in your planned entry zone yet. What is correct?",
      options: [
        "Enter at market so you do not miss it",
        "Wait, or place a limit order in the zone the plan defined",
        "Move the entry to where price is now",
        "Widen the stop and enter anyway",
      ],
      correct: 1,
      why: "Chasing changes your risk-to-reward into something you never tested. The zone is the trade; outside it, there is no trade.",
    },
  ],
  focus: [
    {
      id: "focus-trend",
      question: "In this model, when is a trend considered alive?",
      options: [
        "While the moving averages are stacked",
        "Until the origin of the pullback that created the break gives way",
        "For a fixed 20 candles after a break",
        "While RSI stays above 50",
      ],
      correct: 1,
      why: "Trend is defined objectively: an impulsive close through a swing point starts it, and it stays valid until the pullback's origin breaks.",
    },
    {
      id: "focus-retest",
      question: "Where does the entry come from?",
      options: [
        "The break itself",
        "The retest of the level that was just broken, with a pressure candle at the zone",
        "Any pullback of at least 50%",
        "The close of the next candle, wherever it lands",
      ],
      correct: 1,
      why: "Break and retest. The level that broke has to be re-offered, and a pressure candle has to show up there: a 38.2 candle, an engulfing candle, or a close beyond the previous extreme.",
    },
    {
      id: "focus-stop",
      question: "Where does the stop sit?",
      options: [
        "A fixed number of pips away",
        "One ATR(14) beyond the protecting swing",
        "At the entry candle's low",
        "Wherever the loss feels acceptable",
      ],
      correct: 1,
      why: "The stop is structural plus a volatility buffer, so ordinary noise beyond the swing does not remove you from a valid idea.",
    },
    {
      id: "focus-rr",
      question: "The structural target only pays 1.1R. What now?",
      options: [
        "Take it, a win is a win",
        "Skip it - the model requires at least 1.5R",
        "Move the target further out to make it fit",
        "Halve the stop so the ratio improves",
      ],
      correct: 1,
      why: "The minimum 1.5R is what makes the win rate survivable. Inventing a target or shrinking a structural stop to pass the test defeats the point.",
    },
  ],
  photon: [
    {
      id: "photon-break",
      question: "Price wicks through the swing high and closes back below. What is that?",
      options: [
        "A break of structure",
        "Not a break - only a close through the level counts, so that is a liquidity grab",
        "A break, but a weak one",
        "A reversal signal",
      ],
      correct: 1,
      why: "Breaks are close-confirmed in this model precisely so liquidity grabs do not get counted as trend changes.",
    },
    {
      id: "photon-choch",
      question: "What times the entry after a break of structure?",
      options: [
        "Entering immediately on the break",
        "The internal change of character back in line with the swing trend, after the pullback's counter-trend shift",
        "A fixed retracement percentage",
        "The next session open",
      ],
      correct: 1,
      why: "The counter-trend internal shift says the pullback started; the shift back in line says it finished. That realignment is the entry, not the break.",
    },
    {
      id: "photon-target",
      question: "What is the target?",
      options: [
        "A fixed point target",
        "Weak structure: the high that failed to make a lower low, or the low that failed to make a higher high",
        "The previous day's close",
        "Whatever pays 3R",
      ],
      correct: 1,
      why: "Weak structure is the level price is most likely to reach, because nobody defended it. That is where the model aims, and it still must pay at least 1.5R.",
    },
    {
      id: "photon-stop",
      question: "Why does the stop hide beyond the protecting swing?",
      options: [
        "It is the closest stop possible",
        "Because that is the level a lot of money had to defend, so being wrong there means the idea is genuinely wrong",
        "Because it is always exactly 1 ATR",
        "To keep the loss under a fixed dollar amount",
      ],
      correct: 1,
      why: "The stop belongs where the story breaks, not where it is convenient. Beyond the protecting swing, a hit means the read was wrong.",
    },
  ],
  jablonski: [
    {
      id: "jab-range",
      question: "What defines the range in this method?",
      options: [
        "The whole previous session",
        "The high and low of the first two 15-minute candles of the session",
        "The overnight high and low",
        "The first hour",
      ],
      correct: 1,
      why: "The opening range is the first two 15-minute candles, marked and then left alone. That definition is the whole method.",
    },
    {
      id: "jab-entry",
      question: "When do you take the trade?",
      options: [
        "The moment price touches the range edge",
        "When a 15-minute candle closes above or below the range",
        "On the second touch of the edge",
        "Only after a retest of the range",
      ],
      correct: 1,
      why: "A close beyond the range is the trigger. A touch or a wick is not a signal here.",
    },
    {
      id: "jab-stop",
      question: "Where does the stop go?",
      options: [
        "At the opposite end of the range",
        "Ten points away",
        "Just under the entry candle",
        "At the session open",
      ],
      correct: 0,
      why: "Stop at the far side of the range, target a fixed ten points. The small win with a high hit rate is the edge being claimed - and it is an unverified claim until our own record says otherwise.",
    },
    {
      id: "jab-claim",
      question: "The author claims an 81% win rate. How should you treat that?",
      options: [
        "As proven, they coded a bot",
        "As an unverified claim until this model's own tracked record says so",
        "As a reason to size up",
        "As a guarantee for small targets",
      ],
      correct: 1,
      why: "Every model here is judged on its own filed signals with costs included. Somebody else's number is a hypothesis, not a track record.",
    },
  ],
};

/**
 * Pick the questions for one scan: two model-specific, one shared. Rotating by
 * a seed keeps it varied without ever repeating the same three back to back.
 */
export function pickPreScanQuestions(modelId: AnalysisModelId, seed = Date.now()): PreScanQuestion[] {
  const own = BY_MODEL[modelId] ?? BY_MODEL.classic;
  const i = Math.abs(Math.floor(seed / 1000)) % own.length;
  const a = own[i];
  const b = own[(i + 1) % own.length];
  const s = SHARED[Math.abs(Math.floor(seed / 997)) % SHARED.length];
  return [a, b, s].filter((q, idx, arr) => arr.findIndex((x) => x.id === q.id) === idx);
}

export function preScanQuestionBank(modelId: AnalysisModelId): PreScanQuestion[] {
  return [...(BY_MODEL[modelId] ?? BY_MODEL.classic), ...SHARED];
}
