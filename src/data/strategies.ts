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
      "EMA Crossover Trend is a classic systematic trend-following approach that has been used by professional CTAs and retail traders for decades. Two exponential moving averages - typically the 9 and 21 - are plotted on the chart. When the fast EMA (9) crosses above the slow EMA (21), bias is bullish; when it crosses below, bias is bearish. Rather than chasing the crossover itself, you use it purely as a directional filter and wait for price to pull back into the 21 EMA before entering in the direction of the trend.\n\nThe magic of this system is not in the crossovers - it's in the discipline of only taking trades that align with the higher-timeframe cross and cutting losers small. Most trades will fail because trends are rare; markets range 70-80% of the time. But when a real trend emerges, the winners run for weeks and dwarf the accumulated small losses. That's why the average R:R is high (3.5R+) but the win rate is deliberately low. Trying to raise the win rate by exiting early destroys the entire edge.\n\nIt works best on 4H and daily timeframes in trending assets - major FX pairs, index futures, and liquid crypto. It gets shredded in tight ranges where the EMAs whip back and forth. The single hardest thing about this strategy is psychological: sitting through 6-8 small losers in a row waiting for the one 5R+ trend that pays for the year.",
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
      "Fibonacci Retracement is built on the observation that markets don't move in straight lines - after an impulsive move, they pull back a mathematically predictable portion of the way before continuing. The key ratios (38.2%, 50%, 61.8% and the 78.6% deep-pocket) show up so consistently across every timeframe and asset class that most professional desks have them marked automatically. The 'golden pocket' between 61.8% and 65% is where the highest-probability continuations tend to occur.\n\nThe reason it works isn't mystical - it's reflexive. So many traders watch these levels that they become self-fulfilling. Institutional algos scale in on Fib retracements, stop hunts target the levels just beyond them, and the confluence of pending orders creates real support and resistance. What matters is not the ratio itself but the confluence: a 61.8% pull that lines up with prior structure, a moving average, or a session VWAP is far more powerful than the level in isolation.\n\nThis strategy is at its best when a clean impulsive leg has just printed and the market has room to run. It fails in choppy, overlapping price action where 'the impulse' is subjective. Discipline requires waiting for a candle-close reaction inside the zone rather than front-running the level - blindly buying the 61.8% without confirmation is one of the fastest ways to hand your account to smarter money.",
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
      "Gap and Go is a US equities open-scalping strategy popularized by high-volume day traders. The setup begins pre-market: you scan for stocks gapping 4% or more on fresh catalysts (earnings beats, FDA news, sector momentum) with relative volume well above their 30-day average. These stocks arrive at the 9:30 open loaded with real interest, real emotion, and real order flow - all the ingredients you need for a clean continuation.\n\nThe actual entry is not the gap itself - it's the first breakout of the opening-range high (typically the 1- or 5-minute ORH) with volume expanding. The gap tells you which direction institutions have committed to; the opening range tells you when retail conviction confirms. Fading the gap is a completely different (and far more dangerous) strategy - Gap and Go only works with the trend of the gap, never against it.\n\nThis is a high-frequency, high-focus strategy that lives and dies in the first 30 minutes of the session. Winners are quick (1-2R inside 15 minutes); losers are killed just as fast because the invalidation - a break back into the pre-market range - happens on the same timeframe. It rewards preparation and punishes hesitation. Traders who watch too many tickers or hesitate on entries miss the entire move and end up chasing extended stocks into the 10am reversal.",
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
      "ICT (Inner Circle Trader) Concepts is a smart-money framework that reframes the market as an ongoing battle over liquidity. Instead of drawing traditional support and resistance, you map where stops are almost certainly resting: equal highs, equal lows, session highs/lows, prior day extremes, and obvious swing points. These pools of resting orders are what large participants target to fill their own positions - which means the retail 'obvious level' is often the exact wick that traps you.\n\nThe classic ICT sequence is: (1) HTF bias from the daily draw on liquidity, (2) a liquidity sweep of an opposing pool, (3) a Market Structure Shift (MSS) on a lower timeframe that confirms the reversal, and (4) an entry on the return to the order block or Fair Value Gap (FVG) that caused the shift. Executed cleanly, it produces very tight stops and multi-R runs because you're trading with the flow of orders rather than reacting to price alone.\n\nThe strategy is demanding. It requires you to be comfortable buying wicks into obvious highs and selling drops into obvious lows - the exact opposite of what feels safe. It works best on FX majors, gold, indices, and BTC/ETH during killzone sessions (London 2-5am ET, New York 8-11am ET). Its weakness is over-fitting: the language and tools are seductive, and undisciplined traders will label any wick a 'sweep' and any consolidation an 'order block.' It only works when the criteria are strict.",
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
      "CISD - Change in State of Delivery - is a precision ICT concept that pinpoints the exact bar where the market flips from one delivery regime to the other. Delivery just means 'which side is being served': in a bullish regime, price consistently delivers to buyers by taking out prior highs; in a bearish regime, the opposite. A CISD prints when price closes through the origin open of the most recent opposing leg. That close is not a guess or a pattern - it's a mechanical event you can annotate the moment it happens.\n\nThe power of CISD is that it produces four objective references on every flip: the broken open (the level), the confirming close (the trigger), the 1x measured-move projection, and the 2x extension. That's your setup, entry, TP1, and TP2 handed to you by the structure itself. Pair a higher-timeframe CISD bias with a same-direction lower-timeframe CISD trigger and you have a fully rules-based execution model - no discretion, no 'does this look good?'\n\nThe chart's CISD toggle in this app draws all four references automatically, so you can see the level, trigger, and projections live as they update. The strategy is best deployed on gold, indices, and FX majors on the H1/H4 for bias and M5/M15 for triggers. It struggles in low-volatility drift where legs are too small to project meaningful measured moves - in those environments, respect the fact that the market simply isn't delivering with intent.",
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
      "Mean Reversion using Bollinger Bands is a statistical fade strategy that exploits the tendency of price to snap back to its short-term average after extreme moves. Bollinger Bands (20-period SMA, 2 standard deviations) define a live probability envelope: roughly 95% of price action should occur inside the bands, so a tag of the outer band represents a statistically stretched state that historically reverts.\n\nThe strategy is deceptively simple - short the upper band, long the lower band, exit at the middle band (20 SMA) - but its profitability depends entirely on regime selection. It only works in ranging, non-trending markets. In a real trend, price will ride the outer band for dozens of bars and each fade is a losing trade. Successful mean-reversion traders use a trend filter (ADX below 20, or a flat 200 EMA) to gate every setup and refuse to take signals when the environment is directional.\n\nBecause the average target (mid-band) is closer than a typical trend target, the reward-to-risk is modest (~1.4R) and the win rate needs to be high (60%+) to be profitable. Position sizing discipline is everything - one 'this time it'll turn' trade against a real trend erases weeks of small winners. This makes it an excellent starter strategy for traders who want to build the habit of trading only high-probability, well-defined setups and taking profits without hesitation.",
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
      "Supply and Demand Zone trading is a top-down price-action framework built on the idea that large institutional orders leave behind visible footprints. When a market makes an unusually strong impulsive move away from a small consolidation, that base is treated as an origin - a place where big participants were still building positions when price ran out of shares/contracts to fill. Any return to that origin is likely to trigger the remaining unfilled orders, producing a fresh reaction in the original direction.\n\nZones are drawn from the base (the tight consolidation before the impulse), not from a single candle. The freshness of the zone matters enormously: first touch back to a zone offers the cleanest reaction, second touch is weaker, and by the third the zone is generally considered mitigated. Higher-timeframe zones dominate lower-timeframe zones, so a daily demand zone will absorb an intraday supply zone every time - context is everything.\n\nThe strategy excels in trending environments where zones stack in the direction of the trend, giving you multiple continuation entries. It fails in choppy, overlapping conditions where 'zones' become subjective and every retracement invalidates the last one. Discipline requires trading only fresh, HTF-aligned zones and using rejection candles (engulfing, pin bars) as triggers rather than blindly leaving limit orders inside the zone.",
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
      "Turtle Trading is the legendary mechanical trend-following system developed by Richard Dennis and William Eckhardt in the early 1980s to settle a bar bet: whether great traders were born or made. They took a group of complete novices, taught them a rigid rule set, and produced one of the most profitable trading experiments in history. The system is entirely rules-based - no discretion, no interpretation - which is exactly what makes it hard to actually run.\n\nThe core System 1 rule is a 20-day channel breakout: buy a new 20-day high, sell a new 20-day low, exit on a 10-day breakout in the opposite direction. System 2 uses 55-day breakouts for longer holds. Position sizing is normalized by ATR ('N') so every market risks the same dollar amount per unit of volatility. Pyramiding is allowed - you add to winners every 1/2 N move in your favor - and losers are cut ruthlessly when price moves 2N against entry.\n\nTurtle is emotionally brutal. Win rate is around 30-35%, and long streaks of small losses in ranging markets are inevitable. The entire profitability sits in a handful of massive trend trades per year that pay for everything. Traders who abandon the rules after a drawdown - or who cherry-pick which breakouts to take - destroy the edge instantly. It works best in diversified futures portfolios (currencies, commodities, indices) where uncorrelated trends can develop simultaneously.",
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
      "VWAP - Volume Weighted Average Price - is the single most important intraday reference used by institutional desks. It represents the average price every participant has paid for the session, weighted by the volume traded at each price. That makes it the closest thing to an objective 'fair value' for the day. Above VWAP, buyers are winning and the average long is profitable; below VWAP, sellers are in control. Every professional execution algorithm is benchmarked against it.\n\nThe cleanest plays are first-touch reclaims (price reclaims VWAP after being below) and first-touch rejections (price rejects VWAP from below). These moments represent the point where the day's directional conviction is being tested - either it holds and the trend continues, or it fails and the session flips. Deviation bands (1σ and 2σ) around VWAP give you additional targets and mean-reversion zones that mimic Bollinger bands but with volume weighting.\n\nVWAP works best on liquid intraday instruments: index futures (ES, NQ), high-volume single stocks, and BTC/ETH during US hours. It resets each session, so it's not a swing tool. The most common mistake is treating VWAP as a magic support line and blindly buying it - it only holds when the higher-timeframe trend and session bias agree with the trade. When trend, session, and VWAP all align, few intraday setups are cleaner.",
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
