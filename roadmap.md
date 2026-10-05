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

- Full sequence wired end to end: saved on every scan, scored at resolution
  (seq_shadow_r), Entry trials panel in analytics (live vs OB vs sequence, by
  instrument and session phase), steps passed to the coach text.
- 2-year replay (OANDA 1H, 15m where available, 70/30, costs, fill required,
  daily 20-SMA as bias proxy): Gold -0.42R avg (n=262), Silver -0.91, EUR/USD
  -0.60, GBP/USD -0.65, USD/JPY -0.32; held-out 30% also negative everywhere.
  Win rate 8-25% against far swing targets; tight stops make costs large.
  Raw output: .lovable/sequence-replay-2026-10-05.json.

## Open
- Full sequence: decide next step after the 2-year replay came back negative
  on every instrument (see Done). Keep collecting forward results.
- Decide on findings from the Gold / EUR/USD loser review (waiting on user):
  EUR/USD longs -33R over 49, 44 of them in Aug 2026, costs 0.27R per trade
  (13R of the loss); shorts +9R over 19. Gold longs -46R/99, shorts -31R/129;
  ~25-30% of Gold stops never reached +0.3R; Gold signals filed with a daily
  bias recorded average -0.16R vs -0.43R without. Costs on Gold are small.
- Order-block entry: compare live vs test-mode results once ~30 resolved per
  instrument have filed (ob_shadow_r on signal_scores), then decide.
