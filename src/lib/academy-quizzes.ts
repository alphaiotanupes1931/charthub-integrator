export type QuizQuestion = {
  q: string;
  choices: string[];
  answer: number; // index in choices
  explain?: string;
};

// Soft end-of-module quizzes. 3 questions each, plain-language for older traders.
export const QUIZZES: Record<number, QuizQuestion[]> = {
  1: [
    { q: "A candle shows four prices. Which is NOT one of them?",
      choices: ["Open", "High", "Volume", "Close"], answer: 2,
      explain: "Volume is shown separately, not inside the candle." },
    { q: "A green (bullish) candle means:",
      choices: ["Close is below open", "Close is above open", "The wick is longer than the body", "Nothing, colors are random"],
      answer: 1 },
    { q: "The 'wick' of a candle represents:",
      choices: ["Trading fees", "Price the market rejected", "Only the open price", "The next day's forecast"],
      answer: 1, explain: "Wicks show highs and lows the market pushed to but did not close at." },
  ],
  2: [
    { q: "Support is a price level where:",
      choices: ["Buyers tend to step in", "Sellers overwhelm the market", "The chart resets", "Fees are highest"], answer: 0 },
    { q: "Resistance becoming support after a breakout is called a:",
      choices: ["Rejection", "Flip / retest", "Stop hunt", "Doji"], answer: 1 },
    { q: "Equal highs on a chart often signal:",
      choices: ["Nothing meaningful", "Liquidity resting above", "A guaranteed reversal", "That volume is broken"], answer: 1 },
  ],
  3: [
    { q: "An uptrend is defined by:",
      choices: ["Lower highs, lower lows", "Higher highs, higher lows", "Equal highs and lows", "No structure at all"], answer: 1 },
    { q: "A range is best traded by:",
      choices: ["Buying the top", "Selling the bottom", "Buying support, selling resistance", "Ignoring the levels"], answer: 2 },
    { q: "A break of structure (BOS) means:",
      choices: ["Price broke a prior swing point", "The exchange went down", "Volume disappeared", "News was released"], answer: 0 },
  ],
  4: [
    { q: "A clean setup usually has:",
      choices: ["Multiple confluences and a clear invalidation", "Random entries", "No stop loss", "Only a gut feeling"], answer: 0 },
    { q: "The best R:R (reward-to-risk) for beginners is typically:",
      choices: ["0.5:1 or less", "At least 1.5:1 to 2:1", "10:1 always", "R:R doesn't matter"], answer: 1 },
    { q: "Confluence means:",
      choices: ["One indicator screaming buy", "Multiple signals pointing the same way", "A news event", "A random signal"], answer: 1 },
  ],
  5: [
    { q: "Risking 1% per trade on a $10,000 account means max loss of:",
      choices: ["$1", "$10", "$100", "$1,000"], answer: 2 },
    { q: "Position size should be calculated from:",
      choices: ["Your feelings", "Stop distance and dollar risk", "The candle color", "Time of day"], answer: 1 },
    { q: "A stop loss should be placed:",
      choices: ["Where your idea is invalid", "As close as possible", "Never", "At a round number only"], answer: 0 },
  ],
  6: [
    { q: "A liquidity sweep is when price:",
      choices: ["Grabs stops beyond a level then reverses", "Moves sideways slowly", "Closes at the open", "Prints a doji"], answer: 0 },
    { q: "Equal lows often act as:",
      choices: ["A magnet for stop-hunting", "Guaranteed support forever", "News events", "Nothing"], answer: 0 },
    { q: "Order blocks are:",
      choices: ["Zones of large orders that moved price", "Chart drawing tools", "News alerts", "Types of candles"], answer: 0 },
  ],
  7: [
    { q: "Higher-timeframe bias should:",
      choices: ["Be ignored on lower timeframes", "Guide lower-timeframe entries", "Only matter on Mondays", "Contradict entries"], answer: 1 },
    { q: "Top-down analysis starts on:",
      choices: ["The 1-minute chart", "The highest relevant timeframe", "Any random timeframe", "Only tick charts"], answer: 1 },
    { q: "The 15m entry works best when:",
      choices: ["It contradicts the 4h", "It aligns with 4h trend and 1h structure", "There is no bias", "The market is closed"], answer: 1 },
  ],
  8: [
    { q: "The London session overlaps with:",
      choices: ["Only Sydney", "New York for a few hours", "Never overlaps", "Only Tokyo"], answer: 1 },
    { q: "Highest volatility typically occurs during:",
      choices: ["Asian midnight", "London/NY overlap", "Weekends", "Holidays"], answer: 1 },
    { q: "VWAP stands for:",
      choices: ["Volume Weighted Average Price", "Very Wide Average Point", "Volatility Weighted Auto Price", "Vertical Wave Analysis Pattern"], answer: 0 },
  ],
  9: [
    { q: "A trading journal should record:",
      choices: ["Only wins", "Entry, exit, reason, and outcome", "Nothing", "Only losses"], answer: 1 },
    { q: "Your mental state matters because:",
      choices: ["It affects execution and discipline", "It doesn't", "Only pros track it", "It changes prices"], answer: 0 },
    { q: "Reviewing past trades helps you:",
      choices: ["Spot repeating mistakes", "Guarantee future wins", "Skip risk management", "Predict the market"], answer: 0 },
  ],
  10: [
    { q: "Paper trading is useful for:",
      choices: ["Testing without risk", "Guaranteeing profits", "Skipping learning", "Nothing"], answer: 0 },
    { q: "A kill-switch on drawdown protects you by:",
      choices: ["Closing everything if losses exceed a limit", "Adding to losers", "Doubling risk", "Randomizing size"], answer: 0 },
    { q: "Backtesting means:",
      choices: ["Reviewing how a strategy would have performed on historical data", "Guessing the future", "A prop-firm rule", "A candle pattern"], answer: 0 },
  ],
  11: [
    { q: "Overtrading is often caused by:",
      choices: ["Boredom or revenge after a loss", "A good plan", "Waiting for setups", "Journaling"], answer: 0 },
    { q: "Discipline in trading means:",
      choices: ["Following your plan even when it's uncomfortable", "Ignoring the plan", "Only trading news", "Trading every candle"], answer: 0 },
    { q: "FOMO (fear of missing out) leads to:",
      choices: ["Chasing bad entries", "Better setups", "Higher R:R", "Nothing"], answer: 0 },
  ],
  12: [
    { q: "A trading plan should include:",
      choices: ["Entry rules, risk, and invalidation", "Only entries", "Just a gut feeling", "News tips"], answer: 0 },
    { q: "Consistency comes from:",
      choices: ["Repeating an edge with discipline", "Random trades", "Changing strategies daily", "Ignoring risk"], answer: 0 },
    { q: "Long-term traders focus on:",
      choices: ["Process and risk over any single trade", "Only wins", "Only losses", "Copying others blindly"], answer: 0 },
  ],
};

export function getQuiz(moduleId: number): QuizQuestion[] | null {
  return QUIZZES[moduleId] ?? null;
}
