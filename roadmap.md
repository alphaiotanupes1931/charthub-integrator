# Roadmap

## Done
- Shadow 1R-target tracking: `shadow_tp1r_r` column, computed at resolution and
  backfilled onto 804 historical signals; read-only report `getShadowTp1rReport`.
  First live read: helps Gold (+18.4R over 204 trades) and GBP/USD (+5.0R),
  hurts US30 (-11.9R), NAS100 (-9.0R), SPX500 (-7.0R), EUR/USD (-3.3R).
  Conclusion so far: 1R target is a per-instrument question, not a global one.

- Order-block entry test mode: every new chart scan files a trial entry at the
  15m OB inside the 1H OB (stop past the 1H block); scored at resolution.

- Full-sequence trial (Oct 4 call): rulebook + engine for session phase, 1H
  phase, sweep -> opposite break -> retest -> 15m-in-1H OB body entry; attached
  to every scan result as `sequenceShadow`. Live unchanged.

## Open
- Full sequence: save to signal history + score at resolution, show the
  "Sequence" row on the scan card and a Session phase panel in analytics,
  feed the steps to the coach, then run the 2-year 70/30 held-out replay.
- Entries & direction: investigate Gold losers that never moved in our favour
  (wrong direction or bad entry price) and the EUR/USD long side.
- EUR/USD trading costs: check whether costs eat the edge on that pair.
- Order-block entry: compare live vs test-mode results once ~30 resolved per
  instrument have filed (ob_shadow_r on signal_scores), then decide.
