# Fixing what the entry measurement found

The measurement over 1,000 resolved signals produced one real defect and one
misdiagnosis. This plan fixes the defect, corrects the clock, and then re-checks
the grades, which are almost certainly contaminated by the defect.

## What we are NOT doing

Not switching from limit orders to stop orders. Priced at the level, stop entries
looked like +0.61R against +0.04R. Priced where the market actually was, they
return 0.00R. The whole advantage was buying at a price that had already gone, so
the order type is not the problem and changing it would move nothing.

## 1. Stop publishing signals whose entry price has already gone

The actual defect. On 754 of 1,000 signals price had already closed past the
planned entry on the very first candle after publication, by a median of 0.78 of
the trade's risk. 395 resolved on that first candle, 234 of them as wins that
never moved against us for a second. Those are not calls, they are reports of a
move that already happened, and they are also why a quarter of the stop-entry
trades had no trade left to take.

The scanner already knows how to say "not at the entry yet" when it displays a
plan. The filing path does not run that check, so stale setups still get written
into the record and scored.

- Filing takes the live price and refuses to file when price already sits past
  the entry by more than a tolerance. The refusal is counted and reasoned, not
  swallowed, so the drop in signal volume is visible rather than mysterious.
- Every signal filed from then on stores how far price was from its entry at
  filing, so this can never silently regress and becomes a column on the
  scoreboard.
- Starting tolerance 0.25R. At the measured distribution that refuses about 63%
  of what we currently publish. Before committing I will report what the record
  looks like at 0.1R, 0.25R and 0.5R — win rate, net R and how many signals
  survive at each — so the number is chosen from the trade-off, not guessed.

Expect volume to fall hard and the honest win rate to fall with it, because the
free first-candle wins stop counting. That is the point.

## 2. Set each market's expiry from measured hold time

Signals are being closed as expired while still perfectly alive. The clock is one
number per timeframe: 72 hours on the 1H. Measured 90th-percentile time to
resolution: gold 90 candles, oil 85, NAS100 77, silver 68, GBP/USD 45,
USD/JPY 41.

- Expiry becomes per instrument, taken from the measured figures, stored beside
  the other per-instrument behaviour settings so it is one obvious table.
- Instruments with too small a sample keep today's conservative default rather
  than inheriting a number the data does not support.
- The 47 currently expired rows get re-resolved under the corrected clock. The
  record is append-only, so any row that changes verdict is recorded as a dated
  correction with its old and new value, never quietly overwritten.

## 3. Re-check the grades on clean signals only

Grade separation was previously measured as near zero, and we now know a quarter
of the population was free first-candle wins. Those wins were distributed across
grades by luck, which is exactly what would flatten real separation.

Re-run the grade separation and stop-width reports over non-stale signals only.
This is reporting, not a grade change. If separation appears once the stale rows
are removed, the grading logic was being judged on polluted data. If it stays
flat, the grading logic is genuinely weak and that becomes the next piece of work.

## 4. Say all of this on the public record

The record page currently lists the expiry clock and same-bar fills as open
questions. It gets the measured answer instead: what changed, the date it
changed, that pre-change signals were filed without a staleness check, and that
figures before and after the change should not be pooled.

## Order of work

1. Tolerance report at 0.1R / 0.25R / 0.5R, then agree the number
2. Staleness guard at filing plus the stored entry-distance field
3. Per-instrument expiry, then re-resolve the 47 expired rows with corrections
4. Re-run grade separation on clean signals only
5. Update the public record and methodology notes

## Open questions

- Tolerance: I recommend 0.25R, giving up roughly 63% of current volume. Willing
  to go tighter for trust, or looser to keep signals flowing?
- Should a stale setup be refused outright, or published as "watch only, entry
  gone" with no entry, stop or target? Refusing is cleaner; watch-only keeps the
  user seeing the market.
- The two-year replay results per instrument were built on this polluted
  population too. Re-run them after the guard, or leave them until forward data
  accumulates?

## Technical notes

- Guard belongs in `recordSignalScore` in `src/lib/signal-scores.functions.ts`,
  reusing the distance logic already in `entryTriggerRead`
  (`src/lib/agents/planner.server.ts`) so display and filing cannot disagree.
- New nullable `entry_distance_r` column on `signal_scores`, written at filing;
  no backfill, since the value is unrecoverable for past rows.
- Expiry moves from `EXPIRY_HOURS` in `src/lib/signal-scores.server.ts` to a
  per-instrument figure alongside `holdBars4h` in `src/lib/instrumentBehaviour.ts`.
- Tolerance and clean-population reports reuse the existing read-only hooks
  (`entry-fill-test`, `grade-separation`, `stop-width-test`); no new analysis
  engine needed.
- Corrections table or corrections rows for re-resolved expiries, so
  `src/lib/public-record.functions.ts` can show them rather than hide them.
