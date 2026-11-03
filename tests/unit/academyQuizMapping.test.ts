import { describe, it, expect } from "vitest";
import { QUIZZES } from "@/lib/academy-quizzes";

// Key word each module's quiz must touch, taken from that module's own lessons.
const MUST_MENTION: Record<number, RegExp> = {
  2: /BBHG|retest|break/i,
  5: /liquidity|equal highs|order block/i,
  7: /risk|position size|breakeven/i,
  8: /FOMO|loss|overtrading/i,
  10: /bias|level|exits/i,
};
const FORBIDDEN: Record<number, RegExp> = {
  3: /uptrend|range|break of structure/i,
  5: /position size|stop loss/i,
  6: /liquidity sweep|order block/i,
  7: /higher-timeframe|top-down/i,
  8: /London|VWAP|volatility/i,
  9: /journal|mental state/i,
  10: /paper trading|kill-switch|backtest/i,
};

describe("academy module quizzes match their module", () => {
  it("has 12 modules with 3 questions each", () => {
    for (let m = 1; m <= 12; m++) expect(QUIZZES[m]).toHaveLength(3);
  });
  for (const [m, re] of Object.entries(MUST_MENTION)) {
    it(`module ${m} quiz covers its own lessons`, () => {
      expect(QUIZZES[Number(m)].some((q) => re.test(q.q))).toBe(true);
    });
  }
  for (const [m, re] of Object.entries(FORBIDDEN)) {
    it(`module ${m} quiz has no other-module questions`, () => {
      expect(QUIZZES[Number(m)].some((q) => re.test(q.q))).toBe(false);
    });
  }
});
