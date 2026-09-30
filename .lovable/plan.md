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
