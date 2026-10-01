# Why Gold, Silver and EUR/USD setups lose money

Goal: find where the losses come from before changing any live behaviour. Everything below is read-only research on the resolved history. Historical grades stay as they are.

## Step 1: Break down the losses (read-only)
For each of Gold, Silver, EUR/USD, using decided signals only (no Neutral, void or unfilled), with n shown on every cell:
- Direction wrong vs. right but stopped out: how many losers went past the stop, then reached the target (MAE/MFE data already stored).
- Stop width: loss rate by stop distance in ATR. Would a wider stop have survived, and does it still pay after costs?
- Target reach: how often price reached 1R, 2R and TP1. Is TP1 too far for this instrument?
- Entry: loss rate by how far the entry sat from the scan price and bars waited before fill.
- Session and timeframe: London, New York, Asia; 15m vs 1H vs 4H.
- Grade: whether A/A+ actually beat B/C on these three instruments.

## Step 2: Report and recommend
- Admin-only table per instrument: the top two or three causes, ranked by total R lost.
- Each proposed fix is tested with the pooled rule: minimum 30 per cell, every comparison logged, total R and average R both reported, held-out split for confirmation.

## Step 3: Shadow the winning fix
- Any fix that clears the test runs in shadow next to published signals for Marcus to review. Nothing goes live without his sign-off.

## Technical details
- Reuses signal-replay, stop-width research, excursion (MAE/MFE) and trading-cost modules; new `instrument-loss-breakdown` pure module plus an admin panel and unit tests.
- Costs per instrument from the existing trading-costs table; closed bars only.

## Result (Oct 1, decided signals only)
- Gold n=205 -82.5R, Silver n=71 -33.9R, EUR/USD n=64 -25.3R. Win rate 25-34% vs ~40% needed at 1.5R planned.
- EUR/USD: longs n=49 -33.2R (22% wins), shorts n=15 +7.9R. Costs alone 15.8R of the loss (0.25R per trade).
- Gold: 85 of 153 stops never reached 0.5R (wrong direction/entry); 42 reached 1R first. Grade does not separate (A n=6 worst).
- Exit what-if (MFE upper bound, 9 comparisons): break-even at 1R improves pooled total to -40.5 / -20.9 / -13.3; fixed 1R target to -24.2 / -14.7 / -11.8. Both improve both halves on all three, but none turns positive and only Gold has 30+ per half.
- Next: bar-order replay to confirm the 1R exit, then shadow it. EUR/USD long side and cost per trade are the other leads. No live change.

## Bar-order replay (Oct 1, hourly public feed, fill required, same-bar = stop)
- Replayed 182 Gold / 58 Silver / 43 EUR/USD; matched stored outcome 90% / 83% / 77% (Gold/Silver futures, basis-adjusted weekly).
- Net R pooled, base -> 1R target -> BE at 1R: Gold -42.0 / -32.4 / -39.3; Silver -13.8 / -12.1 / -12.5; EUR/USD -19.8 / -12.2 / -18.2.
- 1R target improves both halves on all three. Break-even barely helps. Nothing turns positive; Silver and EUR/USD cells under 30.
- Real gains are ~25-45% of the MFE estimate. Exits are not the main problem: entries/direction are.
