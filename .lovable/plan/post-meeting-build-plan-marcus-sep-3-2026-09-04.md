# Post-meeting build plan (Marcus, Sep 3)

Everything Marcus raised, split into what is already shipped, what is still broken, and the order to build the rest. Signal accuracy comes first; broker connection and back-testing follow.

## Already shipped (verify with him, no new work)
- Hermes memory now loads into every chat reply (feedback + journal outcomes + backtests).
- Bias computed in code, not by the AI: deterministic engine, fresh-data reconciliation, prior-verdict scrubbing, per-instrument constants incl. Solana.
- New instrument scan opens a fresh chat log; scan panel blanks on instrument switch; chat titles are the instrument, not "BOS/CHoCH".
- Up to 5 images per chat message (4H/1H/15m/5m/1m) with paste and drag-drop; journal accepts pasted images and pasted trade text.
- TradingView tab loads first; drawing tool rail on the live chart.
- PDF button moved next to Show Me and labelled "PDF".
- Signal card: short coach note up top, full case and risk behind "Full analysis".
- Info tooltips on abbreviations, hit rate, average R; A-grade hit rate and last-updated timestamp on the signals page.
- Free tier: 2 grades per day, resets at local midnight, with counters and upgrade copy.
- Strategy is now auto-selected from live market conditions and named on the scan.

## Phase 1 — Signal accuracy (highest priority)
Marcus's core complaint: NASDAQ, US30, gold and BTC/ETH moves were missed while the scan said hold or no entry.

1. **Missed-move audit harness.** Replay the exact bars for the six trades he named (NAS100 and US30 Sep 3, gold Sep 2-3, GBP/USD Sep 3, BTC and ETH breakout) through the current engine and print, per timeframe, what the engine saw versus what happened. This turns "it should have called it" into a failing test we can fix.
2. **Fix what the audit exposes**, expected to be:
   - Break-of-structure detection on the most recent closed 4H/1H candle, with the retest entry that follows it.
   - Overnight/thin-volume stand-down currently suppressing valid index entries before the cash open. Change to: gate the *entry window*, not the signal — publish the setup with "wait for New York open" instead of NO ENTRY.
   - Crypto: no session gate at all (24h market), so BTC/ETH breakouts stop being filtered out.
3. **Regression suite per instrument** so each fix stays fixed, with the neutral-rate guard already in place (alarm above ~40% neutral).

## Phase 2 — Journal automation
Marcus: people only journal if it is one click.

4. **Broker screenshot to P&L.** Paste or upload a closed-positions screenshot from the trade journal, dashboard, or chat; AI reads instrument, direction, size, entry, exit and dollar P&L and logs or closes the matching trade. Reuse the existing closed-trades parser and wire it to single-trade autofill. Fix the current "chart cannot be read, crop tighter" failure with a stronger prompt and a manual-correction step instead of a hard reject.
5. **Save chart with levels into the trade.** The Journal button on the live chart currently stages the image on the device only. Persist it to cloud storage against the journal entry so it survives reload and appears on the other machine.
6. **Save the conversation into the trade.** One click attaches the day's chat log to that journal entry for later review.
7. **Multi-device sync.** Reproduce Mac vs desktop divergence and make cloud state authoritative with last-write-wins per trade; the wipe-on-failed-fetch bug is already fixed, this is the remaining sync gap.

## Phase 3 — Broker connection (read-only)
8. Read-only account link so the coach can see balance, open positions and closed trades in real time, matching the competitor connected to Robinhood. Order of support: TradeLocker and OANDA (already have credential plumbing), then Alpaca/Robinhood-class brokers. No order placement in this phase.
9. Feed live positions into the coach context so trade-management answers stop asking the trader where price is.

## Phase 4 — Per-instrument back-testing
10. Back-test each supported instrument individually and store per-instrument behaviour (typical pullback depth, ATR profile, session character) in the instruments table, so the same Wyckoff rules run with the right constants per symbol. Unknown symbols keep the conservative defaults.
11. Surface per-instrument measured hit rate and expectancy so the signals page numbers are defensible to the VC.

## Phase 5 — Growth flow
12. Email-signup free access with 2 scans a day, then an upgrade pop-up once the daily limit is hit or after enough clicks: "$50/month, 7 days free" with card capture. Confirm the 7-day trial still applies to card signups only.
13. Email capture feeds the drip campaign.

## Technical notes
- Bias, structure, order flow and volume stay in TypeScript; the AI coach only narrates the computed result. No new rules go into prompts.
- The audit harness in Phase 1 is a test fixture, not a UI page, so it can run in CI on every change to the scan engine.
- Chart images and journal attachments move to cloud storage with per-user access rules; nothing device-local.
- Read-only broker access uses per-user tokens; no credentials in client code.

## Open question for Marcus
The 56.4% overall and 88% A-grade hit rates are computed from resolved scans in the database. Once Phase 1 lands, the numbers will move. Do we reset the published stats from the fix date forward, or keep the full history and show both?
