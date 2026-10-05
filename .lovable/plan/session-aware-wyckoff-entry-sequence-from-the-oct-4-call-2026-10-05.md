# Session-aware Wyckoff entry sequence (from the Oct 4 call)

## Goal
Write down the full sequence from the call as one fixed, step-by-step rule. Test it in trial mode next to live signals. Change nothing that works today until results support it.

## The sequence, as agreed on the call
```text
1. Top-down bias      Monthly > Weekly > Daily bias + 4H trend (existing cascade, unchanged)
2. Session phase      What did the last session do? Consolidated / swept / broke structure / continued
3. 1H structural phase  Consolidation, Accumulation, Distribution, or Continuation
4. Confirmation       Sweep of a high or low (wick through, no close beyond),
                      then a break of structure to the OPPOSITE side
5. Retest             Price pulls back past the break toward the order block
6. Entry              15m order block inside a 1H order block, usually with a
                      fair value gap above (long) / below (short)
                      Entry = BODY of the last opposite candle before the big move
7. Target             Swing high (long) / swing low (short)
```
- The break of structure confirms the trade. It never sets the entry price.
- Consolidation with no sweep means no entry. The scan says "waiting for sweep".
- Continuation (structure already confirmed): enter on the next higher low (uptrend) or lower high (downtrend) into an order block, in the direction of the trend. A level on the way does not count as a reversal while a deeper order block in the bias direction is still untouched.

## What changes
1. **One shared rulebook.** A versioned "entry sequence" rulebook holds the steps above. Classic, the coach, and the analytics all read from it, so new ideas can't quietly replace the entry rule again.
2. **Session phase reader.** Builds on the existing Asia/London/New York reader (FX and metals, New York time, adjusts for daylight saving). It now labels each finished session as consolidation, sweep of the high or low, break of structure, or continuation, using closed candles only. The call's session hours (London about 3am–12pm and New York about 8am–5pm New York time, roughly 9 hours each) become the windows. These are close to the current windows, so they will be confirmed against the code before any change.
3. **1H structural phase.** Reuses the trial Wyckoff context reader and returns one of the four phases above, with the sweep and break candles it used.
4. **Trial entry v3: "full sequence".** Added beside the current order-block trial and the strict trial. It only places an entry when steps 1–5 all pass. Changes from the current trial:
   - Requires a real sweep first, then a break to the opposite side. The strict trial checks a change of character, which the call corrected to a sweep.
   - Entry on the order-block candle body, not the wick edge.
   - Stop beyond the 1H block, as now. Target at the swing high or low.
   - If no 1H block qualifies, no entry.
5. **Scan card and analytics.** A small "Sequence" row on each scan: session phase, 1H phase, confirmation status (waiting for sweep / swept / broke structure / retesting), and the trial entry. Analytics gets a "Session phase" panel with the latest phase per instrument and how the trial entries performed in each phase.
6. **Coach.** Explains the phase using these exact steps. It may not suggest entering at the break of structure.

## What does not change
- Live entries, grades, stops, Autopilot, and past results stay as they are.
- The earlier order-block trial and strict trial keep running, so we can compare all four: live, order block, strict, and full sequence.

## Testing before going live
- Unit tests for: sweep with no close beyond the level, break to the opposite side, retest, an entry on the candle body, no 1H block, consolidation with no entry, continuation, daylight-saving weeks, and still-forming candles excluded.
- Replay the last two years of hourly Gold, Silver, EUR/USD, GBP/USD, and USD/JPY with the same costs and fill rules. The first 70% is used to build, the last 30% is held back. The pooled result decides, with at least 30 trades per group. Report total R and average R, and log every run.
- Spot-check five Gold trades from this month's breakout and retest on a chart.
- Going live needs your approval. Expect fewer signals. The results will show how many fewer, per instrument per week.

## Caution
The earlier test of Asia/London/New York bias as a simple direction filter did not improve results. This plan uses session phase as one step in a sequence, which is a different test. It may still fail, and if it does, it stays out of live signals.

## Technical notes
- New: `src/lib/analysis-models/entry-sequence-rulebook.ts`, `src/lib/session-phase.ts` (extends `classic-session-bias.ts`), `src/lib/sequence-entry-shadow.ts` (built on `ob-entry-shadow.ts`, which should use OB body bounds).
- Store v3 in new shadow columns (`seq_shadow_entry/stop/target/label/r`, `session_phase`, `h1_phase`) through a migration. Resolve it in the same replay as the existing `ob_shadow_*` columns.
- Comparison mode reuses `classic-research-backtest.ts` and the `runBacktest` signalFilter hook.
