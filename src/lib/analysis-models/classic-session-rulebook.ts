// Shadow rulebook supplied for TradeMind Classic. These rules are measured in
// historical and forward data before they may affect a live scan.

export const CLASSIC_SESSION_RULEBOOK_VERSION = "classic-session-liquidity-0.1-shadow";

export const CLASSIC_SESSION_RULEBOOK = [
  {
    id: 1,
    title: "Asia accumulation",
    rule: "Use completed New York-local 19:00-00:00 candles. The range qualifies as accumulation only when it is no wider than the median Asia range from the prior 20 complete trading days.",
  },
  {
    id: 2,
    title: "London manipulation",
    rule: "During 02:00-05:00 New York time, price must take exactly one Asia boundary and a closed candle must return inside the Asia range. A low sweep implies bullish distribution; a high sweep implies bearish distribution.",
  },
  {
    id: 3,
    title: "London same-session push",
    rule: "After the London sweep, a London candle body of at least 0.6 ATR must close beyond the opposite extreme of the sweep candle. New York is then expected to continue in that direction.",
  },
  {
    id: 4,
    title: "New York takes liquidity",
    rule: "When London takes neither Asia boundary, wait for 07:00-12:00 New York time to take exactly one Asia boundary and close back inside. Bias is opposite the side taken.",
  },
  {
    id: 5,
    title: "No forced read",
    rule: "Double sweeps are conflicted. Missing bars, incomplete sessions, non-accumulating Asia ranges, and unsupported markets are not applicable or pending. Forming candles never count.",
  },
] as const;

export function classicSessionRulebookForPrompt(): string {
  return [
    `SHADOW RULEBOOK ${CLASSIC_SESSION_RULEBOOK_VERSION}:`,
    ...CLASSIC_SESSION_RULEBOOK.map((rule) => `Rule ${rule.id} - ${rule.title}: ${rule.rule}`),
    "These rules are research-only. Do not use them to change live direction, grade, confidence, entry, stop, or target until the held-out backtest and forward shadow trial are approved.",
  ].join("\n");
}