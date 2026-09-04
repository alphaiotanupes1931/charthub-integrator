// Auto strategy selection: the platform reads current market conditions and
// picks the playbook that fits, instead of making the trader guess.
// Pure + client-safe so the server adapter and the UI share one rulebook.

export const AUTO_STRATEGY = "Auto (AI picks)";

export function isAutoStrategy(name: string | null | undefined): boolean {
  return name === AUTO_STRATEGY;
}

export type MarketRegime =
  | "trend-continuation"
  | "trend-pullback"
  | "breakout-expansion"
  | "range-mean-reversion"
  | "quiet-chop";

export type MarketConditions = {
  /** Entry timeframe of the scan, in TradingView interval form ("15", "60", "240", "D"). */
  interval: string;
  /** 4H trend read. */
  trend: "up" | "down" | "range";
  /** 4H/1H/15m cascade alignment. */
  alignment: "aligned-long" | "aligned-short" | "mixed" | "none";
  /** Fresh change-in-state-of-delivery flip on the anchor timeframe. */
  cisd: "bullish" | "bearish" | "none";
  /** ATR(14) as a percentage of price - how much the instrument is moving. */
  atrPct: number;
  /** 20-bar range as a percentage of price. */
  rangePct: number;
  /** Price sitting at the edge of the 20-bar range (breakout territory). */
  atRangeEdge: boolean;
  /** Last bar volume vs median, 1 = normal. */
  volRatio: number;
  /** Order-book depth read from order flow. */
  depth: "thin" | "normal" | "deep" | "absorbing";
  /** Instrument class, from the ticker. */
  market: "Forex" | "Stocks" | "Crypto" | "Commodities" | "Futures";
  /** Whether a major session is open right now. */
  sessionOpen: boolean;
};

export type AutoStrategyPick = {
  /** Strategy slug from the strategy library. */
  slug: string;
  name: string;
  regime: MarketRegime;
  /** One-line, plain-English reason the trader can read. */
  reason: string;
};

const REGIME_LABEL: Record<MarketRegime, string> = {
  "trend-continuation": "trending market",
  "trend-pullback": "trend with a pullback",
  "breakout-expansion": "breakout and expansion",
  "range-mean-reversion": "range-bound market",
  "quiet-chop": "quiet, choppy market",
};

export function regimeLabel(regime: MarketRegime): string {
  return REGIME_LABEL[regime] ?? regime;
}

function isIntraday(interval: string): boolean {
  const n = Number(interval);
  return Number.isFinite(n) && n <= 60;
}

function isSwing(interval: string): boolean {
  const n = Number(interval);
  return !Number.isFinite(n) || n >= 240;
}

/** Classify what the market is doing right now. */
export function classifyRegime(c: MarketConditions): MarketRegime {
  const trending = c.trend === "up" || c.trend === "down";
  const quiet = c.atrPct < 0.15 || c.volRatio < 0.4 || c.depth === "thin";

  if (trending && c.atRangeEdge && c.volRatio >= 1.1) return "breakout-expansion";
  if (trending && (c.alignment === "aligned-long" || c.alignment === "aligned-short")) {
    return "trend-continuation";
  }
  if (trending) return "trend-pullback";
  if (quiet) return "quiet-chop";
  return "range-mean-reversion";
}

/**
 * Pick the playbook that fits current conditions. Deterministic on purpose -
 * the coach explains the choice, it does not make it.
 */
export function pickStrategyForConditions(c: MarketConditions): AutoStrategyPick {
  const regime = classifyRegime(c);
  const dir = c.trend === "up" ? "uptrend" : c.trend === "down" ? "downtrend" : "range";

  if (regime === "breakout-expansion") {
    if (isSwing(c.interval)) {
      return {
        slug: "turtle-trading",
        name: "Turtle Trading",
        regime,
        reason: `${dir} is breaking the 20-bar range on rising volume on a swing timeframe, so we are trading the breakout continuation.`,
      };
    }
    return {
      slug: "breakout-retest",
      name: "Breakout & Retest",
      regime,
      reason: `Price is breaking the recent range on above-average volume, so we wait for the retest of the broken level instead of chasing.`,
    };
  }

  if (regime === "trend-continuation") {
    if (c.cisd !== "none" && isIntraday(c.interval)) {
      return {
        slug: "cisd-flip",
        name: "CISD Flip (Change in State of Delivery)",
        regime,
        reason: `Timeframes are aligned with the ${dir} and delivery just flipped ${c.cisd}, which is the cleanest continuation entry intraday.`,
      };
    }
    if ((c.market === "Stocks" || c.market === "Futures") && isIntraday(c.interval) && c.sessionOpen) {
      return {
        slug: "vwap-trading",
        name: "VWAP Trading",
        regime,
        reason: `Cash session is open and the ${dir} is aligned across timeframes, so VWAP gives the fairest intraday entry.`,
      };
    }
    if (isSwing(c.interval)) {
      return {
        slug: "ema-crossover-trend",
        name: "EMA Crossover Trend",
        regime,
        reason: `The ${dir} is intact on the higher timeframes, so we ride the trend with moving-average structure rather than hunting reversals.`,
      };
    }
    return {
      slug: "ict-concepts",
      name: "ICT Concepts",
      regime,
      reason: `All timeframes agree with the ${dir}, so we take continuation entries from order blocks and imbalances.`,
    };
  }

  if (regime === "trend-pullback") {
    if (c.atrPct >= 0.4 || isSwing(c.interval)) {
      return {
        slug: "fibonacci-retracement",
        name: "Fibonacci Retracement",
        regime,
        reason: `The ${dir} is still in charge but the lower timeframe is pulling back, so we buy the retracement instead of the extension.`,
      };
    }
    return {
      slug: "supply-demand-zones",
      name: "Supply & Demand Zones",
      regime,
      reason: `The ${dir} holds while price rotates back, so we wait for it to reach a fresh zone before entering.`,
    };
  }

  if (regime === "range-mean-reversion") {
    return {
      slug: "mean-reversion-bollinger",
      name: "Mean Reversion (Bollinger)",
      regime,
      reason: `No higher-timeframe trend and price is rotating inside a defined range, so we fade the extremes back to the middle.`,
    };
  }

  return {
    slug: "supply-demand-zones",
    name: "Supply & Demand Zones",
    regime,
    reason: `Volatility and participation are low, so only a reaction from a clean zone is worth taking - otherwise stand down.`,
  };
}
