export type Level = "Beginner" | "Intermediate" | "Advanced";
export type Style = "Day" | "Swing" | "Scalp";

export interface PlaybookSection {
  title: string;
  items: string[];
}

export interface Strategy {
  slug: string;
  name: string;
  level: Level;
  style: Style;
  markets: string[];
  description: string;
  winRate: number;
  rr: number;
  longDescription?: string;
  playbook?: PlaybookSection[];
}

export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function findStrategyBySlug(slug: string, all: (Strategy | { slug: string })[] = STRATEGIES) {
  return all.find((s) => s.slug === slug) ?? null;
}

export const STRATEGIES: Strategy[] = [
  {
    slug: "breakout-retest",
    name: "Breakout & Retest",
    level: "Beginner",
    style: "Day",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade confirmed breakouts of key support/resistance levels after they retest as new support or resistance.",
    winRate: 58,
    rr: 2.2,
    longDescription:
      "Breakout & Retest is one of the oldest and most reliable price-action strategies in the book. The premise is simple: markets spend most of their time inside well-defined ranges, and when they finally break out of one, the people who were fading the level are trapped on the wrong side. Rather than chase the breakout candle (where risk is huge and fake-outs are common), you wait for price to come back and 'retest' the broken level - what used to be resistance now becomes support, and vice versa.\n\nThe retest is what separates this from a naive breakout trade. It acts as a live filter: if the level really has flipped polarity, buyers/sellers will defend it and price will react cleanly. If it slices back through, the breakout was a liquidity grab and you were never supposed to be in the trade. Because the reaction is fast and defined, your stop can sit tightly on the wrong side of the level, giving you asymmetric risk with 2R+ upside on nearly every trade.\n\nThis strategy thrives in trending environments and around session opens (London, New York) where volume is highest and continuation moves have fuel. It struggles in low-volume, chopping-sideways conditions where every breakout is a trap. The mental model is 'patience over prediction' - you never need to be first, you just need to be right after the market confirms itself.",
    playbook: [
      {
        title: "Setup",
        items: [
          "Mark a clean horizontal level with at least 2 touches on H1 or H4.",
          "Wait for a full body close beyond the level on your entry timeframe (M15-H1).",
          "Look for a pullback that retests the broken level within 1-3 candles.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Enter on confirmation candle off the retest (engulfing, pin bar, or strong rejection wick).",
          "Limit order at the level is allowed only if structure is very clean.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: just beyond the swing created by the retest, never inside the level.",
          "TP1: 1R - move stop to break even.",
          "TP2: next structural level or measured move of the prior range.",
        ],
      },
      {
        title: "Risk",
        items: ["Risk 0.5-1% per trade.", "Max 2 open breakout trades correlated to the same driver."],
      },
      {
        title: "Invalidations",
        items: [
          "Price closes back inside the range after the breakout - skip.",
          "Retest takes longer than 5-7 candles or drifts sideways - skip.",
        ],
      },
    ],
  },
  {
    slug: "ema-crossover-trend",
    name: "EMA Crossover Trend",
    level: "Beginner",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Follow the trend using 9/21 EMA crossovers. A simple, systematic approach that captures the meat of swings.",
    winRate: 45,
    rr: 3.5,
    longDescription:
      "A classic trend-following system. The 9 EMA crossing the 21 EMA defines bias; pullbacks into the 21 EMA in the direction of the cross are your entries. Lower hit rate, but each winner runs because you let trends extend.",
    playbook: [
      {
        title: "Setup",
        items: [
          "9 EMA above 21 EMA on H4 = long bias. Below = short bias.",
          "Wait for price to pull back and touch / wick the 21 EMA on H1.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Enter on the close of the first candle that rejects the 21 EMA in the trend direction.",
          "Skip if pullback overshoots the 21 EMA by more than 1 ATR.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: 1 ATR beyond the swing low/high that formed the pullback.",
          "TP1: 1.5R, scale 50%.",
          "Trail remainder under the 21 EMA on H1 until close back through.",
        ],
      },
      { title: "Risk", items: ["Risk 0.5% per trade.", "Avoid stacking >2 trend trades across correlated pairs."] },
      {
        title: "Invalidations",
        items: ["EMAs flatten or hook back - stand aside.", "Price closes through the 21 EMA against your bias on H4."],
      },
    ],
  },
  {
    slug: "fibonacci-retracement",
    name: "Fibonacci Retracement",
    level: "Intermediate",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade pullbacks to key Fibonacci levels (38.2%, 50%, 61.8%) within established trends.",
    winRate: 57,
    rr: 2.8,
    longDescription:
      "Once a clean impulsive leg prints, drag the fib from swing low to swing high (or vice versa) and wait for price to pull into the 50-61.8% golden pocket with confluence. The deeper the pullback that still holds, the cleaner the continuation.",
    playbook: [
      {
        title: "Setup",
        items: [
          "Identify a strong impulsive leg on H4 (5+ consecutive bodies in one direction).",
          "Draw fib from the start of the leg to its extreme.",
          "Mark 38.2%, 50%, 61.8% and 78.6% as the entry zone.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Enter on a bullish/bearish engulfing or pin bar inside the 50-61.8% zone on H1.",
          "Bonus confluence: previous structure level, 200 EMA, or order block sitting inside the zone.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop just beyond the 78.6% level.",
          "TP1: prior swing high/low (1R or better).",
          "TP2: 1.272 - 1.618 fib extension.",
        ],
      },
      { title: "Risk", items: ["Risk 0.5-1%.", "Do not chase if price never pulls into the zone."] },
      {
        title: "Invalidations",
        items: ["Close beyond 78.6%.", "Pullback turns into a deep, choppy range >20 candles - trend is dead."],
      },
    ],
  },
  {
    slug: "gap-and-go",
    name: "Gap and Go",
    level: "Intermediate",
    style: "Scalp",
    markets: ["Stocks"],
    description: "Trade stocks that gap up or down at open with high volume and momentum.",
    winRate: 55,
    rr: 2,
    longDescription:
      "A US equity open scalp. You are looking for stocks gapping 4%+ on news with relative volume well above average. The play is the first continuation off the opening range, not the gap itself.",
    playbook: [
      {
        title: "Setup",
        items: [
          "Pre-market: scan for gappers >4% with RVOL >5 and a catalyst.",
          "Mark the pre-market high/low and the prior day high/low.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Long: break and hold of the 1-min opening range high in the first 5-15 minutes.",
          "Short: failed breakout into pre-market high that rejects with volume.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: under the breakout candle low (or VWAP if very close).",
          "TP1: 1R, scale 50%, move stop to BE.",
          "Trail the rest under each new 1-min higher low.",
        ],
      },
      { title: "Risk", items: ["Risk 0.25-0.5% (open is volatile).", "One gap trade at a time, no averaging in."] },
      {
        title: "Invalidations",
        items: ["Loss of VWAP on volume.", "Three failed pushes into the same level - move on."],
      },
    ],
  },
  {
    slug: "ict-concepts",
    name: "ICT Concepts",
    level: "Advanced",
    style: "Day",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade Order Blocks and Fair Value Gaps using institutional price delivery concepts.",
    winRate: 55,
    rr: 3.8,
    longDescription:
      "An institutional / smart money framework. You map liquidity (equal highs/lows, session highs/lows), wait for a sweep, then look for a Market Structure Shift (MSS) on a lower timeframe. Entry is a return to the order block or fair value gap that caused the shift.",
    playbook: [
      {
        title: "Bias",
        items: [
          "Daily/H4: define draw on liquidity (where price is most likely to run).",
          "Mark Asia high/low, London high/low, NY high/low.",
        ],
      },
      {
        title: "Setup",
        items: [
          "Wait for liquidity sweep of a session extreme.",
          "Look for MSS / Change of Character on M5 or M1 after the sweep.",
          "Mark the order block or fair value gap that produced the MSS.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Limit entry inside the order block or 50% of the FVG.",
          "Confirmation alternative: small structure shift on M1 inside the OB.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: beyond the high/low of the order block.",
          "TP1: opposing liquidity / nearest equal highs or lows.",
          "TP2: draw on liquidity from the bias step.",
        ],
      },
      { title: "Sessions", items: ["Focus on London Open (02:00-05:00 NY) and NY AM (08:30-11:00 NY)."] },
      {
        title: "Invalidations",
        items: ["No sweep, no trade.", "OB fully traded through without reaction - thesis is invalid."],
      },
    ],
  },
  {
    slug: "cisd-flip",
    name: "CISD Flip (Change in State of Delivery)",
    level: "Advanced",
    style: "Day",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade the ICT delivery flip: HTF bias sets direction, LTF CISD confirms entry, targets are 1x and 2x measured-move projections.",
    winRate: 54,
    rr: 3.2,
    longDescription:
      "CISD marks the exact bar where price closes through the origin open of the prior opposing delivery leg. That flip prints a level (the broken open), a trigger (the confirming close) and a measured-move (the size of the leg it just consumed). This strategy pairs HTF CISD bias with a same-direction LTF CISD trigger and works the 1x / 2x projections as objective targets. The chart's CISD toggle plots all four references (level, trigger, 1x, 2x) automatically.",
    playbook: [
      {
        title: "HTF Bias",
        items: [
          "Enable CISD on H4 or D. HTF bias in the snapshot must read bullish (long only) or bearish (short only).",
          "If HTF bias is neutral, stand down - no trade.",
        ],
      },
      {
        title: "LTF Trigger",
        items: [
          "Drop to M15/M5 and wait for a same-direction CISD flip (state matches HTF).",
          "Trigger is the closing candle that broke the opposing leg's origin open. That close is your reference.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Limit at the CISD level (broken origin open) on the first retest, or",
          "Confirmation entry on the first LTF rejection candle back off the CISD level.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: 1 ATR beyond the far side of the opposing leg (protects the flip).",
          "TP1: the 1x measured-move projection printed by the CISD (scale 50%, move stop to BE).",
          "TP2: the 2x extension. Trail behind each new same-direction CISD on the entry timeframe.",
        ],
      },
      {
        title: "Risk",
        items: ["Risk 0.5-1% per trade.", "Skip if HTF bias flips against you before you fill."],
      },
      {
        title: "Invalidations",
        items: [
          "Price closes back through the CISD level in the opposite direction - the flip is void.",
          "HTF CISD state changes on the next HTF bar before TP1.",
          "No fresh flip has printed in the current window (snapshot says \"no confirmed flip\") - stand down.",
        ],
      },
    ],
  },
  {
    slug: "mean-reversion-bollinger",
    name: "Mean Reversion (Bollinger)",
    level: "Beginner",
    style: "Scalp",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trade price extremes using Bollinger Bands. Buy lower band, sell upper band, in ranging markets only.",
    winRate: 68,
    rr: 1.5,
    longDescription:
      "Works only in ranging, non-trending markets. The bands (20, 2) define statistical extremes. The trade is a fade back to the mid-band (20 SMA). High hit rate, smaller R - position sizing discipline is critical.",
    playbook: [
      {
        title: "Setup",
        items: [
          "Confirm range: ADX < 20 on H1.",
          "Price must tag or pierce the outer band with a rejection candle.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Enter on close back inside the band after the wick.",
          "Skip if the candle that tagged the band is a wide expansion bar (trend forming).",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: 1 ATR beyond the wick that tagged the band.",
          "TP: middle band (20 SMA). Optional 50% scale at opposite band.",
        ],
      },
      { title: "Risk", items: ["Risk 0.5%.", "Max 3 mean reversion trades per session."] },
      { title: "Invalidations", items: ["ADX rises above 25 - range is breaking, exit.", "Two band closes outside - trend has started."] },
    ],
  },
  {
    slug: "supply-demand-zones",
    name: "Supply & Demand Zones",
    level: "Intermediate",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Identify institutional supply and demand zones and trade reactions off them.",
    winRate: 62,
    rr: 2.5,
    longDescription:
      "Supply and demand zones are origins of strong impulsive moves - the base before the move is where unfilled orders likely remain. First touch back into a fresh zone offers the highest probability reaction.",
    playbook: [
      {
        title: "Setup",
        items: [
          "Find an impulsive move that breaks structure on H4.",
          "Mark the base (last 1-3 candles before the impulse) as the zone.",
          "Zone is fresh if untested.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Limit order at proximal line of the zone, or",
          "Confirmation entry on M15 rejection candle inside the zone.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: just beyond the distal line of the zone.",
          "TP1: 50% of prior impulse leg.",
          "TP2: opposing zone or major structure.",
        ],
      },
      { title: "Risk", items: ["Risk 0.5-1%.", "Never use a tested zone - probability drops sharply after first touch."] },
      { title: "Invalidations", items: ["Full body close through the zone.", "Sideways drift inside zone for >10 candles."] },
    ],
  },
  {
    slug: "turtle-trading",
    name: "Turtle Trading",
    level: "Advanced",
    style: "Swing",
    markets: ["Forex", "Stocks", "Crypto"],
    description: "Trend-following system using 20/55-day Donchian breakouts and ATR-based position sizing.",
    winRate: 42,
    rr: 4,
    longDescription:
      "The original Richard Dennis system. Mechanical, unemotional, and brutal in choppy markets - but the winners pay for many small losses. Position sizing is governed by ATR (N) to normalize risk across markets.",
    playbook: [
      {
        title: "System 1 (Short term)",
        items: [
          "Long on close above 20-day high. Short on close below 20-day low.",
          "Skip the signal if the previous System 1 trade was a winner.",
        ],
      },
      {
        title: "System 2 (Long term)",
        items: ["Long on close above 55-day high. Short on close below 55-day low. Take every signal."],
      },
      {
        title: "Position Sizing",
        items: [
          "N = 20-day ATR.",
          "1 Unit = (1% of equity) / (N * dollar value per point).",
          "Add up to 4 units, 0.5N apart.",
        ],
      },
      {
        title: "Stop & Exit",
        items: [
          "Initial stop: 2N from entry.",
          "System 1 exit: close beyond 10-day extreme against you.",
          "System 2 exit: close beyond 20-day extreme against you.",
        ],
      },
      {
        title: "Risk",
        items: ["Max 4 units in one market.", "Max 6 units in correlated markets.", "Max 10 units total directional."],
      },
    ],
  },
  {
    slug: "vwap-trading",
    name: "VWAP Trading",
    level: "Intermediate",
    style: "Day",
    markets: ["Stocks", "Forex"],
    description: "Use Volume Weighted Average Price as dynamic support/resistance for intraday momentum.",
    winRate: 60,
    rr: 2.1,
    longDescription:
      "VWAP is where the average participant is positioned for the day. Above VWAP, intraday bulls are in control; below, bears. The cleanest plays are first-touch reclaims and rejections.",
    playbook: [
      {
        title: "Bias",
        items: [
          "Above VWAP with rising slope = long bias.",
          "Below VWAP with falling slope = short bias.",
          "Flat VWAP = chop, stand aside.",
        ],
      },
      {
        title: "Entry",
        items: [
          "Pullback to VWAP that holds with volume drying up on the test, then a momentum candle in trend direction.",
          "Failed VWAP reclaim short: price pokes through VWAP then closes back below within 2 candles.",
        ],
      },
      {
        title: "Stop & Targets",
        items: [
          "Stop: 1 ATR beyond VWAP at entry.",
          "TP1: high/low of day (HOD/LOD).",
          "TP2: 1st or 2nd standard deviation band.",
        ],
      },
      { title: "Sessions", items: ["Best between 09:30-11:30 NY and 14:00-16:00 NY for equities. London/NY overlap for FX."] },
      { title: "Invalidations", items: ["Three closes against VWAP in trend direction.", "Volume completely dries up - move on."] },
    ],
  },
];
