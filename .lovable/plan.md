# Sweep gate spec + addendum: build plan

Follows Marcus's order, with coach integrity pulled forward. Step 1 is already done.

## Done: Autopilot null-grade check (blocking item)
- Answer: the rail already failed closed, but by accident. `String(null)` turned a missing grade into the text "null", which only ranked 0 by luck. The paper-bot check also let any grade through if the minimum was ever unrecognised.
- Fixed: both checks now refuse anything that isn't a real letter grade (null, "null", HOLD, NO ENTRY, blank), and refuse an unknown minimum instead of guessing. 33 test cases assert this.

## Step 2: One root cause for order type and staleness
- There are three separate order-type labelers (dashboard chart, signal card, chat card). Each one compares entry against whatever price the screen has at that moment, not the price the scan used.
- Confirm against the 9/29 record: scan 1 is stored as 15m, short, entry 1.1325, stop 1.1345 (the spec says 5m / 1.1324 / 1.1342).
- Fix: one shared `deriveOrderType(side, entry, refPrice, tick)` used by all three screens and stored with the signal at filing time. Filing refuses a signal whose stored order type contradicts the table.
- The "stale" item goes into the existing staleness guard, not a second one. Show the cost of slippage in R, calculated in code.

## Step 3: Coach integrity (pulled forward)
- Code computes R numbers (planned R, slippage R, realized R) and passes them to the coach. The prompt forbids the coach from doing its own arithmetic.
- Stop-outs are tied to a trade id. A repeated "sl hit" with no new fill gets a "which trade?" question, not a new loss.
- Three labelled sources: executed trades, scans, platform stats. Every stat shows grade, timeframe, date range and n. If n is under 20 the coach says so. Stats must match the trade's grade.
- One price formatter per instrument (5 decimals for EUR/USD) used in rationale, diagnostics and coach context.
- Flag any setup whose stop sits inside its own stated invalidation.
- Tilt coaching only fires on verified consecutive losing fills in the journal.
- Prompt rules: no "I'll remember this" unless a saved rule actually exists, mark claims about code as hypotheses, and say upthrust/UTAD instead of "spring in reverse".

## Step 4: Sweep gate, shadow only
- Add `validateBosProtection()` to shared pre-entry validation, following the spec's definitions (tolerance max(1 tick, 0.05 ATR), 48-bar expiry, stop at sweep extreme + 0.25 ATR).
- Add the state machine: HOLD, ARMED, ACTIVE, INVALIDATED.
- A per-model `require_sweep` flag defaults OFF. The gate runs in shadow and records what it would have done without changing any published signal.
- A static test fails if any registered model (Classic, Trading Channel, Photon, Eric Jablonski, Wyckoff) can return an entry without calling it.
- Regression test: replaying 9/29 EUR/USD returns HOLD at 1.1366.

## Step 5: Volume measurement (Marcus decides)
- Replay the resolved history four ways: no gate, sweep gate alone, staleness guard alone, both together.
- Report surviving signals per instrument per week, average R per signal, total R, and the count of comparisons run.
- The pooled result decides. No split-level decision below 30 resolved signals.
- Admin-only report. Nothing goes live until Marcus picks the volume.

## Step 6: The two open behaviours (proposed defaults for Marcus to confirm)
- Open position and its scan flips to HOLD/INVALIDATED: an in-app notice says "thesis for your open EUR/USD short changed: <reason>". It never tells the trader to exit and never auto-closes.
- HOLD on the card: a grey "Waiting for sweep" chip with the sweep level and invalidation, no grade chip, and no entry, stop or target fields. The history shows the same. Alerts never send a HOLD.

## Baseline correction (addendum item 5)
- The database has 65 decided EUR/USD signals from Aug 11 to Sep 29: -0.11R gross, -0.355R after costs. The coach's 120 / -0.06R does not hold up. The backtest uses the database figures.
