# Roadmap

## Done
- Shadow 1R-target tracking: `shadow_tp1r_r` column, computed at resolution and
  backfilled onto 804 historical signals; read-only report `getShadowTp1rReport`.
  First live read: helps Gold (+18.4R over 204 trades) and GBP/USD (+5.0R),
  hurts US30 (-11.9R), NAS100 (-9.0R), SPX500 (-7.0R), EUR/USD (-3.3R).
  Conclusion so far: 1R target is a per-instrument question, not a global one.

## Open
- Entries & direction: investigate Gold losers that never moved in our favour
  (wrong direction or bad entry price) and the EUR/USD long side.
- EUR/USD trading costs: check whether costs eat the edge on that pair.
- Entry location (waiting on user's video): entry must be the 1H order block,
  refined to the 15m order block inside it; break of structure is confirmation
  only. Today the planner can fall back to CISD/break levels, liquidity, 4H
  levels, or price minus 0.5 ATR when no 1H OB sits 0.4-2.2 ATR away. No 15m
  refinement exists. Shadow-test before changing live.
