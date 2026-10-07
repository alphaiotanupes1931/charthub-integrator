# Backtest rig: own setups from raw OANDA history

## Goal
Stop testing rules against the app's own signal history. Generate setups straight from OANDA candles back to 2015, using the same detector file the live scanner imports. Then run one pre-registered test, break versus retest, and get a verdict of ADOPT, REJECT or UNDERPOWERED. Live signals do not change.

## Build order (follows the document)

**Day 1: candle store**
- One-time download of M15 and H1 for the 9 instruments (XAU, XAG, EUR/USD, GBP/USD, USD/JPY, NAS100, SPX500, US30, BTC), back to 2015-01-01. Uses bid, ask and mid (`price=MBA`) and the existing OANDA practice key.
- Saved as compressed files per instrument and timeframe, outside the app bundle (about 60 MB). A rerun only fetches new bars.
- M1 is pulled only for bars where the stop and target both sit inside one candle.

**Day 2: bar feeder that cannot see the future**
- Walks forward one bar at a time and hands the detector only bars up to the current index. Higher timeframes expose only completed bars.
- A test plants a trap bar at index+1 and fails if any detector output changes.

**Days 3-4: one shared detector**
- The sweep, break, retest and armed state machine, plus the four entry candidates, move into a single module. The live scanner and the rig both import it, so there is one file and no second copy.
- A static test fails if the live planner builds a signal without calling it. The golden set keeps live prices pinned.

**Day 5: fill simulator and opportunity ledger**
- Real spread from the bid/ask candles, plus commission and modelled slippage.
- A limit order fills only when price trades through the level plus a buffer; a wick tag is not enough.
- If one bar holds both the stop and the target, it is resolved at M1. If M1 is still ambiguous, it counts as a stop, and the rig counts how often that happened.
- One ledger row per opportunity, including unfilled and rejected setups. Each row carries MFE, MAE, time to favourable, the rejection reason and which entry candidate produced the price. Unfilled = 0R.

**Day 6: stats and trials registry**
- Block bootstrap clustered by day, walk-forward splits with purge and embargo, Wilson intervals (existing statistics module), probability of backtest overfitting, and deflated Sharpe.
- The harness writes every variant it evaluates into a trials registry automatically, abandoned ones included. Every run reports its comparison count.
- Ship gate, fixed now: probability of overfitting at or below 0.05, a positive untouched holdout (the most recent 30% of calendar time, touched once), and survival at 1.5x modelled costs.

**Validation before any real test**
- Run the rig over the period the app's signal history covers and diff its setups against what the app actually filed.
- Each divergence is labelled a rig bug or a production bug and resolved. This doubles as the audit of the app data.

**Day 7: first pre-registered test**
- The hypothesis, null and primary outcome are written into the registry before the run.
- Break-close entry versus retest at the broken level, equal risk, intent to trade.
- A power check runs first. The output is ADOPT, REJECT or UNDERPOWERED, with the number that decided it.
- The holdout stays sealed until this final step.

## What does not change
Live entries, grades, Autopilot, and past signals and results. The trials and reports already built keep running.

## Known data limits (labelled in every report)
- Volume is tick count.
- The data is candles, not ticks.
- Index prices are OANDA CFDs, not futures.

## Technical notes
- New `src/lib/detector/` (state machine + candidates, pure). `entry-candidates.ts` and `sequence-entry-shadow.ts` re-export from it, so the planner import is unchanged.
- New `research/rig/`: `download.ts` (OANDA v20 `/instruments/{i}/candles`, `price=MBA`, `count=5000`, paging by `from`), `feeder.ts`, `fills.ts`, `ledger.ts`, `stats.ts` (bootstrap, CSCV probability of overfitting, deflated Sharpe), `registry.ts`, `run-break-vs-retest.ts`, `diff-vs-app.ts`. Run with bun, never bundled into the app.
- Candle store: `research/data/{instrument}_{tf}.jsonl.gz` (gitignored). Ledger exported as CSV for outside tools.
- Registry: a new `research_trials` table (hypothesis, null, primary outcome, variant, comparisons, verdict, created_at), admin-only, and the existing `rule_evidence` log for tier changes.
- Tests: no-lookahead trap, detector-is-shared static check, fill rules (buffer, M1 resolution, pessimistic same-bar), unfilled-as-zero, stats functions on known inputs.
