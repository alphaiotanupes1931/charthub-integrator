import type { ComponentType } from "react";

export type CalloutTone = "amber" | "violet" | "teal" | "rose" | "sky" | "emerald";

export type LessonBlock =
  | { kind: "intro"; text: string }
  | { kind: "list"; lead?: string; items: string[] }
  | { kind: "callout"; tone: CalloutTone; label: string; title?: string; body: string; chart?: LessonChartType; caption?: string }
  | { kind: "chart"; chart: LessonChartType; caption?: string }
  | { kind: "steps"; title: string; steps: string[] }
  | { kind: "takeaway"; body: string };

export type LessonChartType =
  | "buy-low-sell-high"
  | "candles-zones"
  | "support-resistance"
  | "trend-up"
  | "trend-down"
  | "range"
  | "breakout"
  | "retest"
  | "rejection"
  | "continuation"
  | "stop-hunt"
  | "equal-highs"
  | "equal-lows"
  | "liquidity-sweep"
  | "clean-setup"
  | "messy-setup"
  | "risk-reward"
  | "stop-placement"
  | "target-placement"
  | "pre-trade"
  | "phase-map"
  | "candles-generic"
  | "chart-axes"
  | "candle-anatomy"
  | "timeframe-zoom"
  | "volume-basics"
  | "level-flip"
  | "fakeout"
  | "bbhg"
  | "reaction-map"
  | "momentum-shift"
  | "read-loop"
  | "entry-types"
  | "exit-plan"
  | "invalidation"
  | "rr-ladder"
  | "no-trade"
  | "stop-zones"
  | "target-zones"
  | "one-sentence"
  | "liquidity-pools"
  | "order-block"
  | "imbalance-gap"
  | "intent-map"
  | "displacement";

export type Lesson = {
  id: string;      // e.g. "1.1"
  title: string;
  summary: string;
  minutes: number;
  blocks: LessonBlock[];
};

export type Module = {
  id: number;
  title: string;
  subtitle: string;
  accent: string;    // hex, used in the module cards
  lessons: Lesson[];
};

// -----------------------------------------------------------------------------
// Reusable content helpers
// -----------------------------------------------------------------------------

const takeaway = (body: string): LessonBlock => ({ kind: "takeaway", body });

// -----------------------------------------------------------------------------
// MODULE 1 — Chart Foundations
// -----------------------------------------------------------------------------

const module1: Module = {
  id: 1,
  title: "Chart Foundations",
  subtitle: "The building blocks of reading any chart",
  accent: "#f59e0b",
  lessons: [
    {
      id: "1.1",
      title: "What Is Trading?",
      summary: "The one-sentence definition and why price charts exist.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "Trading is exchanging one thing for another, hoping the thing you now hold becomes more valuable. On a chart, that means you buy an asset at one price and sell it later at a different one. The gap between the two is your result." },
        { kind: "list", lead: "At its core, trading involves just a few things:", items: [
          "An asset with a price that moves, like a stock, currency pair, or index",
          "A chart that shows how that price has moved over time",
          "A decision to buy or sell based on what you observe on the chart",
          "A plan for when to exit, whether it goes your way or not",
        ]},
        { kind: "callout", tone: "amber", label: "Simple Example", body: "Imagine watching a price line on a screen. It dips low, then rises high. If you bought when it was low and sold when it was high, that is a trade. The chart is how you saw it happen.", chart: "buy-low-sell-high", caption: "Trading at its simplest: buy when price is low, sell when it rises. The chart is your window into that movement." },
        { kind: "callout", tone: "violet", label: "On a Real Chart", body: "On a real chart you can see zones where buyers stepped in and price rose, and zones where sellers took over and price dropped. You do not need to understand every detail yet, just notice that price moves and the chart shows it.", chart: "candles-zones", caption: "The green zone is where buyers pushed price up. The red zone is where sellers were active. That is what trading looks like on a chart." },
        takeaway("Trading is not magic. It is watching an asset's price move on a chart and deciding whether to buy or sell. Everything else in this course is just detail on top of that idea."),
      ],
    },
    {
      id: "1.2",
      title: "What Is a Chart?",
      summary: "A chart is a picture of price over time. Read it left to right.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "A price chart is a picture. The horizontal line is time, moving left to right. The vertical line is price, higher up means more expensive, lower down means cheaper. Every mark on the chart is a snapshot of what price was doing at that moment." },
        { kind: "list", lead: "Every chart has three things you need to notice:", items: [
          "Time on the bottom, always moving from past to present",
          "Price on the side, showing how expensive the asset is",
          "Bars or candles in the middle, each one covering a set slice of time",
        ]},
        { kind: "callout", tone: "amber", label: "Simple Example", body: "If you look at a chart and the marks are climbing from lower-left to upper-right, price is going up over time. If they are dropping the other way, price is going down. That is the whole idea.", chart: "chart-axes", caption: "Time runs left to right, price runs bottom to top. Rising marks mean an uptrend." },
        { kind: "callout", tone: "violet", label: "On a Real Chart", body: "Real charts pack a lot of information into a small space, but the two axes never change. Time on the bottom, price on the side. Everything else is just detail layered on top.", chart: "candles-generic", caption: "Read left to right. The newest bar is always on the right edge." },
        takeaway("A chart is a picture of price over time. If you can find the two axes and understand which way price moved, you are already reading it correctly."),
      ],
    },
    {
      id: "1.3",
      title: "Candlesticks",
      summary: "Each candle tells you the open, high, low, and close for one slice of time.",
      minutes: 5,
      blocks: [
        { kind: "intro", text: "A candlestick packs four numbers into one shape. The open, the high, the low, and the close. It covers a specific slice of time, one minute, one hour, one day, whatever timeframe you are on." },
        { kind: "list", lead: "Every candlestick has these parts:", items: [
          "The body: the thick block between the open and the close",
          "The wicks: the thin lines above and below the body, showing the highest and lowest prices reached",
          "The color: green or teal usually means price closed higher than it opened, red usually means it closed lower",
        ]},
        { kind: "callout", tone: "amber", label: "Simple Example", body: "A green candle with a small wick on top and a long body means buyers were in control for that whole period. A red candle with a long lower wick means sellers pushed price down, but buyers fought back before the close.", chart: "candle-anatomy", caption: "Body shows the open-to-close range. Wicks show how far price traveled outside that range." },
        { kind: "callout", tone: "violet", label: "On a Real Chart", body: "You will see clusters of candles that tell a story. A run of green candles means momentum is up. A big red candle after a run of green ones can mean the story is changing.", chart: "candles-zones", caption: "Groups of candles reveal momentum. One candle rarely tells the full story on its own." },
        takeaway("A candle is four numbers in one shape. Body for open and close, wicks for the extremes, color for direction. That is all you need to read them."),
      ],
    },
    {
      id: "1.4",
      title: "Timeframes",
      summary: "Higher timeframes show the big picture. Lower timeframes show the detail.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "The timeframe is how much time each candle covers. A 1-hour candle covers 60 minutes of trading. A daily candle covers a full day. Same asset, same chart, but a different level of zoom." },
        { kind: "list", lead: "Higher timeframes vs lower timeframes:", items: [
          "Higher timeframes like the 4-hour and daily reveal the overall trend",
          "Lower timeframes like the 5-minute and 15-minute show intraday detail and noise",
          "The higher timeframe wins arguments. If the daily is up, small dips on the 15-minute usually get bought back",
        ]},
        { kind: "callout", tone: "amber", label: "Simple Example", body: "Zoom out to the daily and you might see a clear uptrend for weeks. Zoom into the 5-minute and you see wobbly ups and downs. Both are true. One is the story, the other is the sentence.", chart: "timeframe-zoom", caption: "Same asset, different zoom. Higher timeframes filter out the noise." },
        takeaway("Higher timeframe for context. Lower timeframe for timing. Always know which one you are looking at."),
      ],
    },
    {
      id: "1.5",
      title: "Trend, Range, and Reversal",
      summary: "Price is doing one of three things at any moment.",
      minutes: 5,
      blocks: [
        { kind: "intro", text: "At any moment, price is doing one of three things. It is trending up, trending down, or moving sideways in a range. When one of those changes into another, that is a reversal. Naming what price is doing is the first job of every trader." },
        { kind: "callout", tone: "amber", label: "Uptrend", body: "Higher highs and higher lows. Each pullback stops above the last pullback. Buyers are in control.", chart: "trend-up" },
        { kind: "callout", tone: "rose", label: "Downtrend", body: "Lower highs and lower lows. Each bounce fails below the last bounce. Sellers are in control.", chart: "trend-down" },
        { kind: "callout", tone: "sky", label: "Range", body: "Price moves between a ceiling and a floor. Neither side is in control. Best traded from the edges, not the middle.", chart: "range" },
        takeaway("Before doing anything else, ask: is this a trend, a range, or a reversal? Everything you decide after that depends on the answer."),
      ],
    },
    {
      id: "1.6",
      title: "Support and Resistance",
      summary: "Levels where price has reacted before tend to matter again.",
      minutes: 5,
      blocks: [
        { kind: "intro", text: "A support level is a price where buyers keep stepping in. Resistance is where sellers keep stepping in. These are not magic lines, they are places where enough orders have historically shown up to change what price does." },
        { kind: "list", lead: "How to spot them:", items: [
          "Look for prices where price has reversed more than once",
          "Cleaner is better. Levels with two or three clean reactions matter more than levels with lots of overlap",
          "The more recent, the more relevant",
        ]},
        { kind: "callout", tone: "violet", label: "On a Real Chart", body: "Draw a horizontal line across the tops of a few candles. If price came down, touched that line, and reversed, that is resistance. Same idea for support along the bottoms.", chart: "support-resistance", caption: "Horizontal lines mark levels where price has reacted more than once." },
        takeaway("Support and resistance are memory. Price remembers where it fought last time, and reacts there again."),
      ],
    },
    {
      id: "1.7",
      title: "Highs, Lows, and Swings",
      summary: "Swing points are the pivots you use to read structure.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "A swing high is a peak with lower peaks on either side. A swing low is a valley with higher valleys on either side. Together, they form the skeleton of every chart. Reading structure means naming the swings." },
        { kind: "list", lead: "Why swings matter:", items: [
          "New higher highs and higher lows confirm an uptrend",
          "New lower highs and lower lows confirm a downtrend",
          "A broken swing structure is the earliest sign the trend is changing",
        ]},
        { kind: "chart", chart: "trend-up", caption: "Every swing high and swing low is a decision point. That is the skeleton of structure." },
        takeaway("Learn to name the swings. Once you can, you can read the trend without any indicators."),
      ],
    },
    {
      id: "1.8",
      title: "Volume Basics",
      summary: "Volume shows how much conviction is behind a move.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "Volume is how many units traded during a candle. High volume means lots of people participated. Low volume means few people cared. Price moves on low volume tend to be less trustworthy than the same move on high volume." },
        { kind: "list", lead: "Basic rules of volume:", items: [
          "Breakouts on high volume are more likely to hold",
          "Rallies on falling volume often stall",
          "Reversals on a big volume spike deserve extra attention",
        ]},
        { kind: "chart", chart: "volume-basics", caption: "Volume bars under price. Breaks with a volume spike carry more weight than quiet drifts." },
        takeaway("Volume is the fuel behind price. A move without fuel usually does not go far."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 2 — Price Behavior + BBHG
// -----------------------------------------------------------------------------

const module2: Module = {
  id: 2,
  title: "Price Behavior + BBHG",
  subtitle: "How price reacts at levels and the BBHG framework",
  accent: "#a855f7",
  lessons: [
    {
      id: "2.1",
      title: "Retests",
      summary: "Price often returns to a broken level before continuing.",
      minutes: 5,
      blocks: [
        { kind: "intro", text: "When price breaks a level and comes back to touch it, that is a retest. Retests are the market's way of testing whether the new direction has real interest, or whether the break was fake." },
        { kind: "callout", tone: "amber", label: "Simple Example", body: "Price breaks above resistance, moves up, then pulls back to that same line. If buyers show up again and push it higher, the retest held and momentum can continue.", chart: "retest", caption: "The old ceiling becomes the new floor. That is a healthy retest." },
        takeaway("Retests give you a second chance to enter a move with a defined risk level. Wait for them."),
      ],
    },
    {
      id: "2.2",
      title: "Continuation",
      summary: "The trend resumes after a pause. Continuation is the norm, not the exception.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "Trends do not move in a straight line. They push, they rest, they push again. The rest is called consolidation, and when the push resumes in the same direction, that is a continuation." },
        { kind: "callout", tone: "amber", label: "Simple Example", body: "In an uptrend, price rallies, then chops sideways for a while, then breaks higher again. That break is the continuation.", chart: "continuation", caption: "A pause followed by another push in the same direction. Trends love to do this." },
        takeaway("Do not fight a trend because it is resting. Continuation is the base case."),
      ],
    },
    {
      id: "2.3",
      title: "Rejection",
      summary: "A hard reaction at a level. Wicks tell you where price refused to go.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "Rejection is when price tries to move through a level, fails, and closes back on the other side. You see it as long wicks on candles at key prices. Rejection is one of the cleanest signs that a level matters." },
        { kind: "callout", tone: "rose", label: "Simple Example", body: "Price spikes above resistance, then immediately closes back below it. That long upper wick is rejection. Sellers were waiting and shut it down.", chart: "rejection", caption: "A long wick is a footprint of rejection. Price tried, then retreated." },
        takeaway("Long wicks at key levels are rejection. Take them seriously, especially on higher timeframes."),
      ],
    },
    {
      id: "2.4",
      title: "Break vs Fakeout",
      summary: "Not every break is real. Closes matter more than wicks.",
      minutes: 5,
      blocks: [
        { kind: "intro", text: "A real break happens when a candle closes cleanly beyond a level and price keeps going. A fakeout is a wick or single candle beyond the level that reverses fast. The difference between the two is the difference between a great trade and a stopped-out one." },
        { kind: "list", lead: "How to tell them apart:", items: [
          "Wait for a candle body to close beyond the level, not just a wick",
          "Watch what happens on the retest. A real break holds, a fakeout snaps back",
          "Volume can confirm. Real breaks usually come with a step up in participation",
        ]},
        { kind: "chart", chart: "fakeout", caption: "A wick beyond the level is a fakeout. A body close beyond it is a real break." },
        takeaway("Do not chase the first candle across a level. Let the market prove the break with a close and a hold."),
      ],
    },
    {
      id: "2.5",
      title: "The BBHG Framework",
      summary: "Break, Breathe, Hold, Go. The four phases at every level.",
      minutes: 6,
      blocks: [
        { kind: "intro", text: "BBHG is a way to describe what price does at every level, in order. Break, Breathe, Hold, Go. If any phase fails, the setup is not clean. If all four happen, you have a high quality move." },
        { kind: "callout", tone: "amber", label: "B — Break", body: "Price closes cleanly through the level. Not a wick, an actual body." },
        { kind: "callout", tone: "sky", label: "B — Breathe", body: "Price pulls back toward the level after the break. This is the retest phase." },
        { kind: "callout", tone: "violet", label: "H — Hold", body: "The old level acts as new support or resistance. Price does not close back through it." },
        { kind: "callout", tone: "emerald", label: "G — Go", body: "Momentum resumes in the direction of the break. This is where the real move happens." },
        { kind: "chart", chart: "bbhg", caption: "All four BBHG phases in order: break the level, breathe back into it, hold it, then go." },
        takeaway("BBHG is a checklist. If you cannot name all four phases on your setup, wait for one that lets you."),
      ],
    },
    {
      id: "2.6",
      title: "Reading Reactions at Levels",
      summary: "How price reacts at a level tells you who is in control.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "Price hitting a level is a question. The reaction is the answer. A soft touch and reverse means the level is respected. A slice straight through means the level is broken. Wicks that fail to close beyond mean rejection." },
        { kind: "chart", chart: "reaction-map", caption: "Three reactions at the same level: respected, rejected, broken." },
        takeaway("Do not predict what price will do at a level. Watch what it actually does, then act."),
      ],
    },
    {
      id: "2.7",
      title: "Momentum Shifts",
      summary: "Momentum shifts show up before price fully reverses.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "A momentum shift is when the character of the move changes. Bigger red candles inside an uptrend. Smaller and smaller pushes to new highs. These are the earliest hints that the tide is turning, before any structure breaks." },
        { kind: "chart", chart: "momentum-shift", caption: "Pushes get smaller, then sellers take over. Momentum shifts before structure does." },
        takeaway("Watch the size and speed of the candles. Momentum shifts precede structural shifts."),
      ],
    },
    {
      id: "2.8",
      title: "Putting It Together",
      summary: "Structure, level, reaction. That is how you read behavior.",
      minutes: 4,
      blocks: [
        { kind: "intro", text: "Reading price behavior is a three-step loop. What is the structure? What level are we near? What is the reaction? Do that on every chart, every timeframe, and the market starts to make sense." },
        { kind: "chart", chart: "read-loop", caption: "Structure, level, reaction. Run the loop on every chart." },
        takeaway("Structure, level, reaction. Repeat until it feels automatic."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 3 — Decision-Making + Execution
// -----------------------------------------------------------------------------

const module3: Module = {
  id: 3,
  title: "Decision-Making + Execution",
  subtitle: "How to think about acting on what you see",
  accent: "#22d3ee",
  lessons: [
    {
      id: "3.1", title: "Entries", summary: "An entry is a decision, not a reflex.", minutes: 5,
      blocks: [
        { kind: "intro", text: "An entry is where you take the trade. Good entries come from waiting for confluence: a level that matters, a reaction that confirms, and a setup that has BBHG cleanly. Bad entries come from chasing candles." },
        { kind: "list", lead: "Three kinds of entries:", items: [
          "Market: click buy or sell right now, at current price",
          "Limit: rest an order at a level, only fills if price comes to you",
          "Stop: rest an order beyond a level, only fills if price breaks through",
        ]},
        { kind: "callout", tone: "emerald", label: "Rule of thumb", body: "If the setup is not clean enough to explain in one sentence, do not take it." },
        { kind: "chart", chart: "entry-types", caption: "Market fills now, limit waits below price, stop triggers above price." },
        takeaway("Entries are decisions. Slow down enough to make them on purpose."),
      ],
    },
    {
      id: "3.2", title: "Exits", summary: "Exits win or lose the game. Plan them before you enter.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Every trade needs two exits: one where you are wrong (the stop) and one where you are right (the target). Decide both before you click buy. Once the trade is live, emotions try to change the plan." },
        { kind: "chart", chart: "exit-plan", caption: "Both exits mapped before entry: stop zone below, target zone above." },
        takeaway("Both exits get planned before entry. That is the rule."),
      ],
    },
    {
      id: "3.3", title: "Invalidation", summary: "The price that says the setup is broken.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Invalidation is the price that proves you were wrong. Not almost wrong, actually wrong. Your stop lives just beyond invalidation, so if the idea is broken, you are out quickly and cheaply." },
        { kind: "chart", chart: "invalidation", caption: "Invalidation is a price, not a feeling. Beyond it, the idea is dead." },
        takeaway("Invalidation is a level, not a feeling. Find it before you enter."),
      ],
    },
    {
      id: "3.4", title: "Risk vs Reward", summary: "Only take trades where reward outweighs risk.", minutes: 5,
      blocks: [
        { kind: "intro", text: "Risk to reward is the ratio between what you can lose and what you can win. If you risk one to make one, you need to be right most of the time. If you risk one to make three, you can be wrong more than half the time and still profit." },
        { kind: "callout", tone: "amber", label: "Rule of thumb", body: "Aim for at least 1:2. Anything below 1:1.5 is usually not worth the mental cost." },
        { kind: "chart", chart: "rr-ladder", caption: "Risk one to make three. You can be wrong more than half the time and still profit." },
        takeaway("A great trader with bad risk-reward loses money. A mediocre trader with great risk-reward wins over time."),
      ],
    },
    {
      id: "3.5", title: "When Not to Trade", summary: "The best trade is often no trade.", minutes: 4,
      blocks: [
        { kind: "intro", text: "There are days where the chart offers nothing clean. There are moods where your judgement is off. There are news events where price does not follow structure. On those days, the winning move is to close the platform." },
        { kind: "chart", chart: "no-trade", caption: "Chop with no clean level. This is a day to stay flat." },
        takeaway("You do not have to trade every day. The market will be here tomorrow."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 4 — Guided Review + Practice
// -----------------------------------------------------------------------------

const module4: Module = {
  id: 4,
  title: "Guided Review + Practice",
  subtitle: "Apply what you have learned with confidence",
  accent: "#34d399",
  lessons: [
    {
      id: "4.1", title: "Spot the Phase", summary: "Name whether price is trending, ranging, or reversing.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Practice by opening any chart and naming what price is doing in one sentence. Uptrend on the daily, range on the 1-hour, reversal forming on the 15-minute. If you cannot name it, you cannot trade it." },
        { kind: "chart", chart: "phase-map", caption: "Trend, range, reverse. Name the phase before anything else." },
        takeaway("If you cannot name the phase, you have no business being in the trade."),
      ],
    },
    {
      id: "4.2", title: "Break, Breathe, Hold, or Go?", summary: "Say which BBHG phase price is in right now.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Look at your current setup. Which BBHG phase is price in? Missing a phase means missing a piece of the setup. Naming it out loud forces you to see clearly." },
        { kind: "chart", chart: "bbhg", caption: "Point at the chart and say which BBHG phase price is in right now." },
        takeaway("Say the phase out loud. It sharpens your read every time."),
      ],
    },
    {
      id: "4.3", title: "Clean Setup vs Messy Setup", summary: "Learn to walk away from messy ones.", minutes: 4,
      blocks: [
        { kind: "intro", text: "A clean setup has a clear level, a clear reaction, a clear stop, and a clear target. A messy setup requires you to squint or draw extra lines to justify. If you have to convince yourself, it is messy." },
        { kind: "callout", tone: "emerald", label: "Clean", body: "Clear level, clean BBHG, obvious invalidation. One-sentence explanation.", chart: "clean-setup" },
        { kind: "callout", tone: "rose", label: "Messy", body: "Overlapping levels, unclear structure, no obvious stop. Skip it.", chart: "messy-setup" },
        takeaway("Clean or nothing. The market provides plenty of clean setups if you are patient."),
      ],
    },
    {
      id: "4.4", title: "Read the Reaction", summary: "How did price behave at the last touch?", minutes: 4,
      blocks: [
        { kind: "intro", text: "Look at the last time price hit your level. Did it wick and reverse? Did it break through? Did it grind through slowly? The most recent reaction is a strong clue about the next one." },
        { kind: "chart", chart: "reaction-map", caption: "Check the last touch. Respected, rejected, or broken?" },
        takeaway("Recent behavior is the best guess for near-term behavior."),
      ],
    },
    {
      id: "4.5", title: "Where Would You Place a Stop?", summary: "Practice defining risk on every chart you look at.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Even when you are not trading, practice placing a mental stop. Where is the price that says you are wrong? Doing this on every chart trains your eye to see risk first." },
        { kind: "chart", chart: "stop-zones", caption: "Stops belong beyond structure, not right at the level." },
        takeaway("Practice placing stops even when you are not trading."),
      ],
    },
    {
      id: "4.6", title: "Where Would You Take Profit?", summary: "Every stop needs a target on the other side.", minutes: 4,
      blocks: [
        { kind: "intro", text: "The other half of the practice. Where would you take profit? Aim for a level with clear historical significance, at least twice as far as your stop." },
        { kind: "chart", chart: "target-zones", caption: "Target the next obvious level, then the major one beyond it." },
        takeaway("A target without a level is a guess. Always anchor to structure."),
      ],
    },
    {
      id: "4.7", title: "Explain It in One Sentence", summary: "If you can not, do not trade it.", minutes: 4,
      blocks: [
        { kind: "intro", text: "The final filter. Explain the setup out loud in one sentence: what you see, where you enter, where you are wrong, where you take profit. If the sentence gets tangled, the setup is not ready." },
        { kind: "chart", chart: "one-sentence", caption: "Level, reaction, target. If the sentence does not fit, the trade does not either." },
        takeaway("One sentence. If it takes more, walk away."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 5 — Liquidity + Intent
// -----------------------------------------------------------------------------

const module5: Module = {
  id: 5,
  title: "Liquidity + Intent",
  subtitle: "How price hunts orders before the real move",
  accent: "#f472b6",
  lessons: [
    {
      id: "5.1", title: "What Is Liquidity?", summary: "Liquidity is where the orders sit.", minutes: 5,
      blocks: [
        { kind: "intro", text: "Liquidity is the pool of resting orders. Stops, limit orders, breakout orders, all clustered at obvious prices. Big participants need liquidity to fill their trades, so price tends to travel to where liquidity lives." },
        takeaway("Ask on every chart: where would most people place their stops? That is where liquidity is."),
      ],
    },
    {
      id: "5.2", title: "Equal Highs + Equal Lows", summary: "Two matching pivots stack orders above or below.", minutes: 4,
      blocks: [
        { kind: "intro", text: "When price makes two peaks at nearly the same price, traders assume that level is resistance and place stops just above it. Same for equal lows. These stacks of stops are magnets for the next move." },
        { kind: "callout", tone: "amber", label: "Simple Example", body: "Two matching highs sit at 21500. Every short trader parks a stop just above. When price finally reaches for that liquidity, all those stops fire at once, and price often runs fast through the level.", chart: "equal-highs" },
        takeaway("Equal highs and equal lows are advertised liquidity. Price sees them too."),
      ],
    },
    {
      id: "5.3", title: "Stop Hunts", summary: "Fast pokes above or below levels to trigger stops.", minutes: 4,
      blocks: [
        { kind: "intro", text: "A stop hunt is a fast spike that runs through a level, triggers stops, and then reverses. It looks violent but predictable. If you know where stops are stacked, you can predict where the hunts will happen." },
        { kind: "chart", chart: "stop-hunt", caption: "Fast spike beyond the level, then a rapid reversal. Classic stop hunt." },
        takeaway("Stops get hunted. That is the game. Place yours where they are harder to run."),
      ],
    },
    {
      id: "5.4", title: "Liquidity Sweeps", summary: "A sweep grabs liquidity before the real move begins.", minutes: 5,
      blocks: [
        { kind: "intro", text: "A sweep is when price makes a fake move to grab liquidity, then immediately reverses in the opposite direction. Sweeps are often the best entries because they mark the exact point where the real move began." },
        { kind: "chart", chart: "liquidity-sweep", caption: "Price runs stops, then reverses hard. That reversal is the trade." },
        takeaway("Wait for the sweep, then trade the reversal. Do not chase the fake move."),
      ],
    },
    {
      id: "5.5", title: "Order Blocks", summary: "The last opposite candle before a strong move.", minutes: 4,
      blocks: [
        { kind: "intro", text: "An order block is the last down candle before a strong up move, or the last up candle before a strong down move. Institutions leave footprints there. Price often returns to those candles later to fill the rest of the orders." },
        { kind: "chart", chart: "order-block", caption: "The last opposing candle before displacement. Price often returns to it." },
        takeaway("Order blocks are where the big money left orders unfilled. Watch them on retests."),
      ],
    },
    {
      id: "5.6", title: "Imbalances and Gaps", summary: "Fast moves leave gaps price tends to fill.", minutes: 4,
      blocks: [
        { kind: "intro", text: "When price moves too fast, it leaves a gap between candle wicks. These gaps are called imbalances. Price often returns to fill them before continuing, because the missing trades still need to happen." },
        { kind: "chart", chart: "imbalance-gap", caption: "Fast moves leave an imbalance. Price frequently comes back to fill it." },
        takeaway("Gaps get filled more often than not. Do not ignore them."),
      ],
    },
    {
      id: "5.7", title: "Reading Intent", summary: "Is price building a level or breaking through?", minutes: 4,
      blocks: [
        { kind: "intro", text: "Intent is a fancy word for asking: what is price trying to do right now? Is it building energy at a level, or is it trying to break through? The answer tells you whether to trade the level or the breakout." },
        { kind: "chart", chart: "intent-map", caption: "Slow overlapping candles build a level. One decisive push breaks it." },
        takeaway("Every candle is a message. Ask what the market is trying to accomplish."),
      ],
    },
    {
      id: "5.8", title: "Fair Value and Displacement", summary: "Big candles that shift the balance leave the strongest footprints.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Displacement is a strong, fast move that leaves an imbalance behind. It is a signal of intent. When you see displacement, the direction of that candle is usually the direction to trade." },
        { kind: "chart", chart: "displacement", caption: "Displacement candle shifts the balance, then price returns to fair value." },
        takeaway("Big displaced candles are the market showing its hand. Follow the direction."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 6 — Clean Setups + Confluence
// -----------------------------------------------------------------------------

const module6: Module = {
  id: 6,
  title: "Clean Setups + Confluence",
  subtitle: "How to find the setups that make the most sense",
  accent: "#facc15",
  lessons: [
    {
      id: "6.1", title: "What Makes a Setup Clean?", summary: "Level, reaction, invalidation. All three, or nothing.", minutes: 5,
      blocks: [
        { kind: "intro", text: "A clean setup has three things visible without squinting: a level that matters, a reaction that confirms, and an obvious invalidation. If any one is fuzzy, the setup is not ready." },
        { kind: "chart", chart: "clean-setup", caption: "Clear level, clean reaction, obvious stop location." },
        takeaway("Clean setups are rare, but they are worth waiting for."),
      ],
    },
    {
      id: "6.2", title: "Messy vs Clean", summary: "Learn what to skip.", minutes: 4,
      blocks: [
        { kind: "intro", text: "A messy setup has overlapping levels, unclear structure, weak reactions, or a stop that would have to be huge. Every skipped messy setup is money saved for a clean one." },
        { kind: "chart", chart: "messy-setup", caption: "Overlap, unclear structure, no obvious level. Pass." },
        takeaway("Skipping messy setups is a skill. It is the skill most beginners lack."),
      ],
    },
    {
      id: "6.3", title: "Level + Reaction", summary: "The two ingredients that must be present.", minutes: 4,
      blocks: [
        { kind: "intro", text: "The minimum viable setup is a level plus a reaction. Everything else is a bonus. If either one is missing, wait." },
        takeaway("No level, no trade. No reaction, no trade."),
      ],
    },
    {
      id: "6.4", title: "Confluence", summary: "Multiple reasons stacking in one spot.", minutes: 5,
      blocks: [
        { kind: "intro", text: "Confluence is when several things point to the same level. A support line, a moving average, a Fibonacci level, and an order block all in one price zone means the level is stronger than any of them alone." },
        { kind: "list", lead: "Common sources of confluence:", items: [
          "Support or resistance level",
          "Trendline or moving average",
          "Fibonacci retracement",
          "Prior high or low",
          "Session open or close",
        ]},
        takeaway("Two reasons is a signal. Three is a strong signal. Four is a screaming signal."),
      ],
    },
    {
      id: "6.5", title: "Timeframe Alignment", summary: "The higher timeframe wins arguments.", minutes: 4,
      blocks: [
        { kind: "intro", text: "A great setup on the 15-minute is worth more when the 1-hour and 4-hour agree with it. When timeframes disagree, take the direction of the highest one you can see." },
        takeaway("Trade with the higher timeframe, not against it."),
      ],
    },
    {
      id: "6.6", title: "Session Timing", summary: "Some hours matter more than others.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Not all hours are equal. The London and New York sessions carry the most volume for most instruments. The overlap between them is often the cleanest window of the day." },
        takeaway("Trade during sessions with real volume. Everything else is guesswork."),
      ],
    },
    {
      id: "6.7", title: "News and Events", summary: "Scheduled news events break structure. Know when they are.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Central bank decisions, jobs reports, and earnings releases can wipe out any technical setup. Check the calendar. Do not enter new trades in the 15 minutes before a major event." },
        takeaway("Respect the calendar. Do not fight news with charts."),
      ],
    },
    {
      id: "6.8", title: "Setup Grading", summary: "Not every setup is A+. Grade before you trade.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Grade every setup A+, A, B, C. Only trade the A+ and A grades. B might be worth a smaller size. C is a pass. Grading forces you to be honest with yourself before you click." },
        takeaway("If it is not at least an A, it is not a trade."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 7 — Risk + Trade Management
// -----------------------------------------------------------------------------

const module7: Module = {
  id: 7,
  title: "Risk + Trade Management",
  subtitle: "How to protect yourself while letting good trades work",
  accent: "#fb7185",
  lessons: [
    {
      id: "7.1", title: "Risk Per Trade", summary: "Never risk more than a small percent of your account.", minutes: 5,
      blocks: [
        { kind: "intro", text: "Risk per trade is the maximum you are willing to lose if the trade goes wrong. For most traders, that number is one to two percent of the account. Any higher and one bad streak can wipe you out." },
        { kind: "callout", tone: "amber", label: "Rule of thumb", body: "Ten straight losses at 2 percent leaves you with 82 percent of the account. Ten straight losses at 10 percent leaves you with 35 percent. Small percentages compound in your favor when you are wrong." },
        takeaway("Risk small. The market will still be here after your worst losing streak."),
      ],
    },
    {
      id: "7.2", title: "Where Stops Go", summary: "Stops go beyond the invalidation level, not before it.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Your stop belongs on the far side of invalidation, not just at the level. Give it a small buffer so a normal wick does not take you out of a valid trade." },
        { kind: "chart", chart: "stop-placement", caption: "Place the stop beyond invalidation, with a small buffer for noise." },
        takeaway("Stops go beyond the noise, not inside it."),
      ],
    },
    {
      id: "7.3", title: "Where Targets Go", summary: "Targets belong at the next meaningful level.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Your target belongs at the next real level, not at a round number and not at some arbitrary distance. Look for the next swing high, the next support zone, the next liquidity pool." },
        { kind: "chart", chart: "target-placement", caption: "Target the next real level. Round numbers are not levels." },
        takeaway("Targets are structural, not numerical."),
      ],
    },
    {
      id: "7.4", title: "Position Sizing", summary: "Size the position so the stop equals your risk.", minutes: 5,
      blocks: [
        { kind: "intro", text: "Position sizing is the math that ties everything together. Given your account, your risk percentage, and your stop distance, there is exactly one right position size. Use the Risk Calculator inside the platform on every trade." },
        takeaway("Size the position to the stop, not the other way around."),
      ],
    },
    {
      id: "7.5", title: "Moving to Breakeven", summary: "Once the trade works, protect the entry.", minutes: 4,
      blocks: [
        { kind: "intro", text: "When price has moved a meaningful amount in your favor, move your stop to your entry price. Now the worst case is a zero-loss trade. The best case is still open." },
        takeaway("Breakeven is not required. But it is a good habit once a trade is clearly working."),
      ],
    },
    {
      id: "7.6", title: "Scaling Out", summary: "Take partial profit to lock in results.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Scaling out means closing part of the position at an early target and letting the rest run. It secures a win and takes the emotion off the remaining size." },
        takeaway("Scaling out is not required, but it is a psychological release valve."),
      ],
    },
    {
      id: "7.7", title: "Cutting Losses Fast", summary: "The best traders lose small.", minutes: 4,
      blocks: [
        { kind: "intro", text: "If the setup is invalidated before your stop is hit, do not wait. Get out. The stop is a hard limit, not a target. Cutting losses at the first sign the idea is wrong is what separates pros from amateurs." },
        takeaway("If the reason for the trade is gone, the trade is over."),
      ],
    },
    {
      id: "7.8", title: "Trade Journaling", summary: "Every trade goes in the journal.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Log every trade with entry, exit, stop, target, reason, and mental state. Patterns emerge only when you have data. Without the journal, you keep repeating the same mistakes without noticing." },
        takeaway("The journal is where you actually improve. Use it on every trade."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 8 — Mindset + Discipline
// -----------------------------------------------------------------------------

const module8: Module = {
  id: 8,
  title: "Mindset + Discipline",
  subtitle: "How to stay calm enough to follow the plan",
  accent: "#60a5fa",
  lessons: [
    {
      id: "8.1", title: "Patience vs Impulse", summary: "The trade you do not take is often the win.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Impulse is the itch to click. Patience is the discipline to wait for the setup you defined. The market will always give you another opportunity. The account you blew on impulse is harder to get back." },
        takeaway("Patience is not passive. It is an active choice on every candle."),
      ],
    },
    {
      id: "8.2", title: "Chasing vs Waiting", summary: "Chasing means entering after the move is gone.", minutes: 4,
      blocks: [
        { kind: "intro", text: "If the move has already happened and you feel like you have to get in now, that is chasing. The good entry is behind you. Wait for the retest or the next setup. Chasing is how you buy the top." },
        takeaway("If you feel late, you are late. Wait."),
      ],
    },
    {
      id: "8.3", title: "Fear of Missing Out", summary: "FOMO is the enemy. Recognize it and pass.", minutes: 4,
      blocks: [
        { kind: "intro", text: "FOMO is watching a big move happen and feeling like everyone is getting rich except you. It is a lie. Most people entered late and got stopped out. The move you missed was not for you." },
        takeaway("Missed moves cost nothing. Bad trades taken from FOMO cost real money."),
      ],
    },
    {
      id: "8.4", title: "Revenge Trading", summary: "Do not chase a loss. Close the platform.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Revenge trading is when you take a bad trade right after a loss, trying to make the money back immediately. It never works. Losses cluster because you get emotional and take even worse setups. Walk away." },
        takeaway("After a loss, take a break. Do not click again until you have cooled off."),
      ],
    },
    {
      id: "8.5", title: "Overtrading", summary: "More trades is not more profit.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Overtrading is taking more trades than the market actually offers. Every session has a limited number of clean setups. If you are taking ten trades and the average is three, you are forcing." },
        takeaway("Quality over quantity. Always."),
      ],
    },
    {
      id: "8.6", title: "Sticking to the Plan", summary: "The plan is the only thing you can control.", minutes: 4,
      blocks: [
        { kind: "intro", text: "You cannot control what price does. You can control whether you followed your plan. Judge yourself on that, not on the outcome. A losing trade taken correctly is a good trade." },
        takeaway("Grade your process, not your results. Results will follow."),
      ],
    },
    {
      id: "8.7", title: "Handling Losses", summary: "Losses are the cost of doing business.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Even the best traders lose 40 to 50 percent of their trades. Losses are not a sign you are bad. They are the price of playing. What matters is how you react. A calm loss is a professional loss." },
        takeaway("Losses are not personal. Treat them like a business expense."),
      ],
    },
    {
      id: "8.8", title: "Handling Wins", summary: "Wins are dangerous too. Stay humble.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Wins feel great, and that feeling is dangerous. After a good streak, traders often size up, skip their process, and give it all back. Treat wins with the same discipline you treat losses." },
        takeaway("The market humbles everyone. Do it to yourself first."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 9 — Real Chart Story Reading
// -----------------------------------------------------------------------------

const module9: Module = {
  id: 9,
  title: "Real Chart Story Reading",
  subtitle: "How to read what price is doing from beginning to end",
  accent: "#c084fc",
  lessons: [
    {
      id: "9.1", title: "Reading the Full Story", summary: "Every chart tells a beginning, middle, and end.", minutes: 5,
      blocks: [
        { kind: "intro", text: "A chart is a story with three parts. Where the move started, what is happening now, and where it is likely heading. Reading in that order stops you from jumping to conclusions." },
        takeaway("Start, middle, end. In that order. Every time."),
      ],
    },
    {
      id: "9.2", title: "Where Did the Move Start?", summary: "Find the origin, not just the current candle.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Zoom out and find the last major swing low or high that started the current move. That is where the story began. Everything else is a chapter of that story." },
        takeaway("The origin gives context. Without it, you are reading a random page."),
      ],
    },
    {
      id: "9.3", title: "What Is Price Doing Now?", summary: "Name the current phase in one sentence.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Look at the last five to ten candles. What is happening? Consolidation, breakout, pullback, reversal, fake? Name it. If you cannot, wait." },
        takeaway("If you cannot name what is happening in one sentence, wait."),
      ],
    },
    {
      id: "9.4", title: "Where Is It Likely Going?", summary: "The next real level is the next likely destination.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Look ahead on the chart to the next major level in the direction of the current move. That is your first target. Anything past that is a bonus." },
        takeaway("Do not predict. Identify the next level and trade to it."),
      ],
    },
    {
      id: "9.5", title: "Reading Momentum", summary: "Big candles and small candles tell different stories.", minutes: 4,
      blocks: [
        { kind: "intro", text: "A run of big, one-sided candles means momentum is strong. A run of small, alternating candles means momentum is fading. Read the shape of the recent candles like you would read tone in a voice." },
        takeaway("Candle size is voice tone. Loud or quiet, angry or calm."),
      ],
    },
    {
      id: "9.6", title: "Reading Rejection Wicks", summary: "Wicks show what price refused to do.", minutes: 4,
      blocks: [
        { kind: "intro", text: "A long wick at a level is a footprint of rejection. Multiple long wicks in the same zone is a strong signal that the level is being defended." },
        takeaway("Wicks are footprints. Read them."),
      ],
    },
    {
      id: "9.7", title: "Reading Volume Shifts", summary: "Volume tells you when the story changes.", minutes: 4,
      blocks: [
        { kind: "intro", text: "A sudden spike in volume, especially at a level, marks a change in the story. Someone big just showed up. Note the direction of that candle." },
        takeaway("Volume spikes are chapter breaks in the story."),
      ],
    },
    {
      id: "9.8", title: "Telling Someone Else", summary: "If you can teach it, you understand it.", minutes: 4,
      blocks: [
        { kind: "intro", text: "The final test. Explain the chart to a friend as if they have never traded. If your explanation is clear, your read is solid. If you get tangled, your read is not ready." },
        takeaway("Teach the chart out loud. It exposes fuzzy thinking instantly."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 10 — Execution Lab
// -----------------------------------------------------------------------------

const module10: Module = {
  id: 10,
  title: "Execution Lab",
  subtitle: "How to apply everything with structure and confidence",
  accent: "#4ade80",
  lessons: [
    {
      id: "10.1", title: "Pre-Trade Checklist", summary: "Do not click without ticking every box.", minutes: 5,
      blocks: [
        { kind: "intro", text: "A checklist forces you to stop and think. Every trade should pass it. If any box is missing, no trade." },
        { kind: "steps", title: "Before you click:", steps: [
          "Higher timeframe bias identified",
          "Level marked and clean",
          "BBHG phase named",
          "Entry, stop, and target defined",
          "Risk-to-reward at least 1:2",
          "Position size calculated",
          "No major news in the next 30 minutes",
        ]},
        takeaway("The checklist is your last line of defence against impulse."),
      ],
    },
    {
      id: "10.2", title: "Bias First", summary: "Decide direction before you look for entries.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Bias is your directional lean based on the higher timeframe. Decide it first, then only hunt for setups in that direction. Trading both ways at once is how you get chopped up." },
        takeaway("Bias first, setup second. Never the reverse."),
      ],
    },
    {
      id: "10.3", title: "Mark the Level", summary: "Draw the level before you look for the entry.", minutes: 4,
      blocks: [
        { kind: "intro", text: "The level comes before the trade. Draw it in advance so it is objective. If you draw it after price is already there, you will draw it to fit what you want to see." },
        takeaway("Draw levels when the market is calm. Trade them when it arrives."),
      ],
    },
    {
      id: "10.4", title: "Wait for the Reaction", summary: "Do not enter at the level. Wait for the reaction.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Levels are not entries. The reaction at the level is the entry. Wait for the wick, the reversal candle, or the break of a short-term structure before you click." },
        takeaway("The level is where you look. The reaction is where you click."),
      ],
    },
    {
      id: "10.5", title: "Enter With a Reason", summary: "You should be able to explain the trigger.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Every entry needs a specific trigger. A wick rejection, a break-and-retest, an engulfing candle, a change of character. If your reason is 'it looked good', you have no reason." },
        takeaway("A trade without a trigger is a wish."),
      ],
    },
    {
      id: "10.6", title: "Manage With Structure", summary: "Let structure decide when to exit, not emotions.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Once you are in, manage the trade based on structure, not on feelings. As price makes higher highs and higher lows, trail your stop with the structure. Break the structure, and you are out." },
        takeaway("Structure manages the trade. You just click."),
      ],
    },
    {
      id: "10.7", title: "Exit at Structure", summary: "Take profit at the next real level, not at a random number.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Your target was set based on structure. When price gets there, take the profit. Do not move the target further just because it feels like the move will continue." },
        takeaway("Take profit at the level. Do not get greedy."),
      ],
    },
    {
      id: "10.8", title: "Review Every Trade", summary: "Every trade goes into the journal. Every one.", minutes: 4,
      blocks: [
        { kind: "intro", text: "After the trade, screenshot the chart, note the setup, note the outcome, note your mental state. Weekly, look for patterns. That is where real growth comes from." },
        takeaway("Review is where the training happens. Do it every week."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 11 — Replay + Practice Lab
// -----------------------------------------------------------------------------

const module11: Module = {
  id: 11,
  title: "Replay + Practice Lab",
  subtitle: "Learn by spotting, checking, and repeating",
  accent: "#38bdf8",
  lessons: [
    {
      id: "11.1", title: "Spot the Setup", summary: "Practice spotting setups on historical charts.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Use the replay feature on any charting platform. Rewind time and try to spot setups before they play out. This is the fastest way to train your pattern recognition." },
        takeaway("An hour of replay is worth a week of live trading in learning speed."),
      ],
    },
    {
      id: "11.2", title: "Find the Phase", summary: "Name the phase before you look at what happened next.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Pause the replay. Name the phase. Then let it play. If your read was right, note it. If it was wrong, ask why. Do this a hundred times and your read gets sharp." },
        takeaway("Pause, name, unpause, review. Do it hundreds of times."),
      ],
    },
    {
      id: "11.3", title: "Is It Clean or Messy?", summary: "Practice classifying every setup you see.", minutes: 4,
      blocks: [
        { kind: "intro", text: "For every setup you spot in replay, ask: is this clean or messy? Would I take this live? Building this filter is more important than any specific pattern." },
        takeaway("Your filter is the most important skill. Sharpen it in replay."),
      ],
    },
    {
      id: "11.4", title: "Draw the Trade", summary: "Draw entry, stop, and target on the chart.", minutes: 4,
      blocks: [
        { kind: "intro", text: "For every setup in replay, actually draw the entry, stop, and target on the chart. See what the risk-reward looks like. Then let it play and see what would have happened." },
        takeaway("Drawing the trade is more useful than just naming it."),
      ],
    },
    {
      id: "11.5", title: "Compare to the AI Scan", summary: "See how your read matches the platform's grade.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Run a scan on the platform and see what grade it assigned. Compare that to your own read. Where do you agree? Where do you differ? The gaps are where you learn fastest." },
        takeaway("Use the AI scan as a sparring partner, not a crutch."),
      ],
    },
    {
      id: "11.6", title: "Paper Trade the Setup", summary: "Turn on Testing Mode and actually take it.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Once you have a setup that passes your filter, turn on Testing Mode and take it with paper money. Live emotions with zero risk. It is the closest thing to real practice." },
        takeaway("Paper trading builds the emotional muscle. Do it before you go live."),
      ],
    },
    {
      id: "11.7", title: "Track the Results", summary: "Log every practice trade like a real one.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Even practice trades go in the journal. That is where you see your true hit rate, your average R, your best setup type. Data does not lie. Feelings do." },
        takeaway("Journal every practice trade. Numbers reveal what feelings hide."),
      ],
    },
    {
      id: "11.8", title: "Repeat Until Automatic", summary: "Repetition is how skill is built.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Spot, classify, draw, play, review. Then do it again. Then again. There is no shortcut. Skill in trading is repetition of a good process until it becomes automatic." },
        takeaway("There is no shortcut. Repetition is the shortcut."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------
// MODULE 12 — Mastery + Final Review
// -----------------------------------------------------------------------------

const module12: Module = {
  id: 12,
  title: "Mastery + Final Review",
  subtitle: "Bring everything together into one repeatable framework",
  accent: "#facc15",
  lessons: [
    {
      id: "12.1", title: "Chart Foundations Review", summary: "Timeframes, candles, structure. All second nature.", minutes: 5,
      blocks: [
        { kind: "intro", text: "By now, reading a chart should feel like reading a page. Two axes, candles, higher highs, higher lows. No indicators required. If any part still feels foreign, go back to Module 1." },
        takeaway("Foundations first. Everything is built on them."),
      ],
    },
    {
      id: "12.2", title: "Price Behavior Review", summary: "BBHG on every level, every time.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Every level gets the BBHG check. Break, breathe, hold, go. If a level is missing a phase, it is not ready. That framework alone can shape your whole approach." },
        takeaway("BBHG on every level. Not most levels. Every level."),
      ],
    },
    {
      id: "12.3", title: "BBHG Review", summary: "The four phases. Say them in your sleep.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Break, Breathe, Hold, Go. That is the entire framework. If you can name the current phase on any chart, you can trade any market." },
        takeaway("Four words. Four phases. Everything else is detail."),
      ],
    },
    {
      id: "12.4", title: "Liquidity Review", summary: "Where are the stops? That is where price wants to go.", minutes: 4,
      blocks: [
        { kind: "intro", text: "On every chart, ask where the obvious stops are. Above the double top? Below the double bottom? That is the liquidity, and that is a magnet for the next move." },
        takeaway("The market moves to the money. The money is at the stops."),
      ],
    },
    {
      id: "12.5", title: "Risk Review", summary: "Risk 1 to 2 percent. Always.", minutes: 4,
      blocks: [
        { kind: "intro", text: "Risk small, size to the stop, plan the exit before entry. Break any of those rules, and no amount of skill will save the account." },
        takeaway("Rules are what keep the account alive."),
      ],
    },
    {
      id: "12.6", title: "Mindset Review", summary: "Calm, patient, humble. Repeat.", minutes: 4,
      blocks: [
        { kind: "intro", text: "The mental game is the whole game once you have skill. Calm on losses. Humble on wins. Patient on nothing setups. That is the top of the pyramid." },
        takeaway("Mindset is the ceiling. Skill is the floor."),
      ],
    },
    {
      id: "12.7", title: "Building Your Framework", summary: "Write your own one-page trading plan.", minutes: 5,
      blocks: [
        { kind: "intro", text: "Take everything you have learned and write it down in one page. Your instruments, your timeframes, your setups, your risk rules, your session hours, your journal habits. That page becomes your identity as a trader." },
        takeaway("Write it down. What is not written is not real."),
      ],
    },
    {
      id: "12.8", title: "What Comes Next", summary: "Practice, journal, repeat, forever.", minutes: 4,
      blocks: [
        { kind: "intro", text: "There is no finish line. The best traders keep drilling the basics, keep journaling, keep reviewing. The market does not change. Only your relationship with it does." },
        takeaway("This is not a course you finish. It is a process you practice."),
      ],
    },
  ],
};

// -----------------------------------------------------------------------------

export const ACADEMY: Module[] = [
  module1, module2, module3, module4, module5, module6,
  module7, module8, module9, module10, module11, module12,
];

export function findModule(id: number): Module | undefined {
  return ACADEMY.find((m) => m.id === id);
}

export function findLesson(moduleId: number, lessonId: string): { mod: Module; lesson: Lesson; index: number; prev?: Lesson; next?: Lesson } | undefined {
  const mod = findModule(moduleId);
  if (!mod) return undefined;
  const index = mod.lessons.findIndex((l) => l.id === lessonId);
  if (index < 0) return undefined;
  return {
    mod,
    lesson: mod.lessons[index],
    index,
    prev: mod.lessons[index - 1],
    next: mod.lessons[index + 1],
  };
}

// Marker for React type usage in this file (unused but keeps type import active).
export type _AcademyIcon = ComponentType<{ className?: string }>;
