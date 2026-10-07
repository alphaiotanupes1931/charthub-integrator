# Entry framework: break as a trigger, four measured entry candidates

## Goal
A break of structure only moves the setup forward. It never sets the price. Each confirmed break produces four candidate entries. All four are recorded, and each instrument switches to the winning candidate only when the measured comparison says so. Live signals stay exactly as they are until then.

## 1. Guardrails first (stops a silent entry swap from happening again)
- **entry_model on every signal.** A new field says which method produced the live price: `order_block`, `imbalance`, `broken_level`, `retracement_618_79`, or `legacy` (today's planner). Older rows are backfilled as `legacy`.
- **Golden set.** 30 frozen bar windows (Gold, Silver, EUR/USD, GBP/USD, USD/JPY, indices, crypto) with the expected entry, stop and entry_model saved. A test runs them on every build. Any change to an entry price fails the build until someone updates the expected values on purpose.
- **Shadow diff.** Every scan computes the live entry and the flagged new entry side by side. It stores the gap in price and in R. Analytics shows the diff per instrument, so nobody is surprised at switch time.

## 2. The state machine
```text
idle -> swept (wick through, close back inside)
     -> broke (close through the opposite swing)   <- confirmation only, no price
     -> armed (four candidates computed from the impulse)
     -> filled / expired / invalidated
```
Built on the existing sweep-and-break reader in the sequence trial. Closed candles only.

## 3. Four candidates from the same confirmed break
| Candidate | Level |
|---|---|
| Order block | Body of the last opposite candle before the impulse (15m inside 1H when present) |
| Imbalance | Near edge of the impulse's fair value gap |
| Broken level | The swing price that was broken (the baseline the others must beat) |
| Retracement band | 0.618 to 0.79 of the impulse, entry at the 0.705 midpoint |

**Fair test rules:** the same stop distance in R for every candidate (risk held equal), the same target, and the same costs. A candidate that never fills counts as **0R** and stays in the sample. If stop and target land on the same candle, it counts as a stop.

## 4. Evidence tiers
Each rule in the rulebook carries a tier, and code enforces what each tier may do:
- **A**: may block a trade
- **B**: may adjust grade and size only
- **C / D**: recorded only

A rule only moves up a tier through a logged measurement record (test, sample size, result), never by editing a label. Starting tiers: broken-level entry B (current baseline), the other three candidates C, FVG presence C, 15m-in-1H nesting D, session sequence D.

## 5. Flag and switch
- `entry_model_v2` flag, off by default and settable per instrument.
- When it is on for an instrument, that instrument uses its winning candidate. The shadow diff keeps running in both directions.
- Switching needs your approval, based on the comparison report.

## 6. Research, in your order
1. **Break vs retest (first).** Compare entering at the break close with each of the four retest candidates. Uses the roughly 1,000 stored signals plus a two-year replay. Before anything else, a power check confirms the sample can detect an effect big enough to change the decision. If it can't, the report says stop.
2. **Session-sequence null benchmark (before any session feature).** Compare London breaching the Asian range against random windows matched on range width, window length and realised volatility. Only the excess over that null counts.
3. FVG and nesting stay recorded only (tier C/D) until a later test.

All runs use pooled results, at least 30 per group, a 70/30 build and held-out split, total R and average R, and every run logged.

## 7. Reporting
The analytics entry panel gets a new section with, per instrument: fill rate, average and total R for each candidate (unfilled counted as 0), the shadow diff against live, and each rule's current tier.

## What does not change
Live entries, grades, stops, Autopilot and past results. The existing order-block, strict and sequence trials keep running.

## Missing
The attachment did not come through, and I don't have the ready-to-paste research prompt or its six non-negotiables. Five of them are covered above from your note. Please resend it, and I'll fold in the rest.

## Technical notes
- Migration: `signal_scores.entry_model text not null default 'legacy'`, plus `cand_{ob,fvg,bos,fib}_{entry,filled,r}` and `live_vs_v2_diff_r`. A new `rule_evidence` table (rule_id, tier, test, n, result, created_at) with admin-only writes.
- New `src/lib/entry-candidates.ts` (pure, reuses `orderBlocks.ts` and `findSweepAndBreak`). Tier enforcement lives in `entry-sequence-rulebook.ts`.
- Golden set: `tests/golden/entry-windows/*.json` and `tests/unit/entryGoldenSet.test.ts`, runnable through the existing vitest/CI workflow.
- Wired through `planner.server.ts` `trialFields`, `signal-engine.functions.ts`, scan persistence and resolver. The research scripts reuse `classic-research-backtest.ts` and `exit-trials.ts`.
