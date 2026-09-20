# Classic session-bias backtest

## Goal
Turn the supplied Asia–London–New York idea into deterministic rules, measure it against the current Classic results, and make no live-scan change until the evidence supports it.

## Scope agreed
- Apply only to FX and metals.
- Define session boundaries from New York local time so daylight-saving changes are handled.
- Test the idea first as a directional filter, not as a new grade, confidence boost, or replacement for the current daily bias.
- Keep all current Classic signals, scores, and public replay results unchanged during testing.

## Build
1. Add a versioned Classic session-liquidity rulebook containing the supplied material and its measurable interpretation.
2. Build a closed-bar-only session reader that records:
   - Asia high, low, range, and whether the range qualifies as accumulation.
   - Whether London swept the Asia high or low and closed back inside the range.
   - Whether London displaced in the reversal direction during the same session.
   - Whether London took neither side.
   - Which side New York swept first and whether price then displaced in the opposite direction.
3. Translate the three supplied cases:
   - Asia accumulation + London sweep/reversal: expect New York distribution in the reversal direction.
   - London takes neither Asia boundary: wait for New York to take one side, then expect the opposite direction only after a closed-bar reversal.
   - London sweep + same-session displacement: expect New York continuation in that displacement direction.
4. Return `bullish`, `bearish`, `pending`, `conflicted`, or `not-applicable`, with an audit trail naming the bars and levels used.
5. Exclude incomplete sessions, weekends/holiday-like gaps, insufficient bars, indices, oil, and crypto. Ambiguous double sweeps remain `conflicted`, never forced into a direction.

## Backtest
1. Add a read-only comparison mode to the existing historical engine; do not overwrite the published track record.
2. Run the current Classic rules and the session-filtered Classic rules on the exact same two-year, 1-hour bars for:
   - XAU/USD
   - XAG/USD
   - EUR/USD
   - GBP/USD
   - USD/JPY
3. For the filtered version, retain a current Classic trade only when its side agrees with a completed session-bias read. Pending, conflicted, or opposite reads are skipped.
4. Report per instrument and combined:
   - Candidate trades, retained trades, and percentage filtered out.
   - Wins, losses, timeouts, hit rate, gross average R, net average R, cost R, net R, drawdown, and sample size.
   - A/A+ results separately, with the same denominator rules as the scoreboard.
   - Results for each of the three session patterns separately.
5. Split the two years chronologically: first 70% for observation, final 30% held out. Do not tune thresholds against the held-out period.
6. Add a five-trade visual spot check showing the Asia range, London event, New York confirmation, entry, stop, target, and outcome.

## Validation gates
- Unit tests cover bullish/bearish sweeps, no-London-sweep cases, same-session displacement, double sweeps, DST transitions, missing bars, and forming-bar exclusion.
- The baseline run must reproduce the current engine results on identical bars.
- The comparison must use identical costs, stops, targets, entry timing, and exit rules; only the session-bias filter may differ.
- No live Classic behavior changes from this phase.

## Decision after results
Recommend a forward shadow trial only if the filter improves held-out net expectancy without relying on a tiny sample or one instrument. Any later live rollout remains reversible and begins as a blocking filter only. If it fails, retain the material as coach education and do not feed it into live direction or grades.
