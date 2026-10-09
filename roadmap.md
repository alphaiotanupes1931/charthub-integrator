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

- Entry framework v2 (Oct 5 brief): break only advances a state machine; four
  equal-risk candidates (order block, imbalance, broken level, 0.618-0.79) saved
  on every scan (entry_candidates) and scored at resolution (entry_candidate_r,
  unfilled = 0R); entry_model on every signal (all 'legacy'); shadow diff
  (entry_diff_r); evidence tiers (A block / B grade+size / C,D record) with a
  rule_evidence log; golden set of 30 frozen windows in CI; analytics section.
- Research run 1, break vs retest (2y OANDA 1H, 10,373 setups, power check OK):
  market entry at the break close -0.13R avg; retest at the broken level +0.02R;
  +0.14R pooled, +0.12R held-out. OB, imbalance and 0.618-0.79 did NOT beat the
  broken level (all within +/-0.013R). Raw: .lovable/research/.
- Session null benchmark: London breaches Asia 82.5% vs 78.7% matched null
  (+3.8pp). Real only on EUR/USD (+12pp), GBP/USD (+15pp), US30 (+7pp); none on
  Gold, Silver, crypto.

- Backtest rig (Oct 6 brief): OANDA M15+H1 bid/ask 2015-2026 for 9
  instruments in research/data (gitignored, rerun only fetches new bars);
  no-future feeder; ONE shared detector (src/lib/detector/entry-detector.ts)
  imported by planner and rig; bid/ask fill simulator (buffer, stop slippage,
  M1 for same-bar ambiguity, else pessimistic); opportunity ledger (CSV);
  stats (day bootstrap, walk-forward+embargo, PBO, deflated Sharpe); trials
  registry (research/registry/trials.jsonl + research_trials table).
- Rig vs app audit: of 1,367 filed signals, 328 matched a rig setup, 211 the
  rig read the opposite way, 828 had no sweep+break at all (legacy planner);
  168 (12%) had an entry price had already passed. 615 rig setups never filed.
- First pre-registered test break-vs-retest-v1: gate verdict ADOPT. Retest beat
  the break by +0.078R build, +0.047R holdout, +0.143R at 1.5x costs. BUT both
  lose money in absolute terms, the gain is below the 0.1R decision effect, and
  it shrank to ~+0.01R in the three most recent folds.

## Open
- Decide on break-vs-retest-v1 (user): relative ADOPT, but under 0.1R and
  decaying. Next pre-registration should require delta >= decision effect.
- Resolve audit divergences: 828 app-only signals (planner not gated on
  sweep+break) and 168 already-passed entries. Production behaviour, not rig bugs.
- Entry v2 switch: needs user approval per instrument. Evidence so far favours
  waiting for a retest over entering at the break; it does not single out the
  order block. Confirm on forward entry_candidate_r before switching.
- Resend of the framework attachment (research prompt + six non-negotiables).
- Full sequence: decide next step after the 2-year replay came back negative
  on every instrument (see Done). Keep collecting forward results.
- Decide on findings from the Gold / EUR/USD loser review (waiting on user):
  EUR/USD longs -33R over 49, 44 of them in Aug 2026, costs 0.27R per trade
  (13R of the loss); shorts +9R over 19. Gold longs -46R/99, shorts -31R/129;
  ~25-30% of Gold stops never reached +0.3R; Gold signals filed with a daily
  bias recorded average -0.16R vs -0.43R without. Costs on Gold are small.
- Order-block entry: compare live vs test-mode results once ~30 resolved per
  instrument have filed (ob_shadow_r on signal_scores), then decide.
- Oct 5 history checks (full suite 1,138 passing first): Gold daily-bias match
  41 trades -0.13R avg vs 37 against -0.19R vs 150 no bias -0.43R (cells <30);
  44 Gold losers reached +1R before stopping (-44.3R); EUR/USD cost<=0.1R 11
  trades +0.40R vs 57 -0.50R. Wider-stop outcome needs candle replay.
- Exit trials replay (Oct 5, `src/lib/exit-trials.ts`, 1y hourly, fill required,
  net of costs): Gold breakeven at +1R n=207, -82.1R -> -77.4R (36 changed);
  EUR/USD min stop width (cost <=0.1R) n=63, -26.3R -> -18.2R (18 changed).
  Both still negative; neither ready for live.
- EUR/USD min stop width runs as an on-demand trial (`getMinStopTrialReport`);
  every new EUR/USD signal is included automatically. Revisit at ~100 trades.
- Claude loser review (351 Gold/Silver/EUR/USD, numbers rechecked in DB): filed
  13-15 UTC n=99 -0.07R avg; 16-19 UTC n=88 -0.62R (-54.7R); other n=164 -0.50R.
  Longs into bearish daily bias n=18 -0.75R (weak). Grade shows no edge.
  Hour-window trial (9-12 NY, Oct 5, net R, oldest 70% build / newest 30% held):
  build window n=59 -0.10R (-6.0R) vs other n=187 -0.55R (-103.5R); held window
  n=40 -0.02R (-0.9R) vs other n=65 -0.52R (-33.5R). Holds out of sample but the
  window is still not profitable; keeps ~35% of signals. Not live; user decides.

## Decisions 2026-10-07 (per framework doc)
- [x] Already-passed entries: existing 0.5R staleness guard covers it; 0 of 199 signals filed since 2026-09-20 broke it. The 168 found by the audit predate the guard.
- [x] No-sweep/no-break signals: record only (gate has no tier A evidence); shadow sweep records keep labelling them.
- [x] Break vs retest: no live switch; held-out gain below the 0.1R decision size. Rig verdicts from v2 on require reaching that size.
- [ ] Re-run break-vs-retest v2 once forward entry candidates reach 30 per instrument (waiting on new scans).
- [x] Oct 7 check: 39 signals filed in the last 3 days, none carry trial entries.
  Sandbox scan of EUR/USD produces all three trials (OB, sequence, 4 candidates),
  so the code is right; the live site is running a build from before the fix.
  Blocker: publish, then confirm the next filed signals carry trial data.

## Trader type onboarding (Oct 8)
- [x] Phase 1: in-app trader type step after signup, Your Setup screen, profile-driven first week, coach tone in chat, dashboard prompt for existing users
- [x] Phase 2: public /quiz ("What's your trader type?"), share cards and per-type share pages, answer carry-over, UTM/ref capture
- [ ] GoHighLevel lead sync: built, waiting on GHL_API_KEY and GHL_LOCATION_ID
- [ ] Marcus to confirm the strategy table and question wording
- [ ] go.trademindai.ai/quiz to link to /auth?answers=<code> (or just to /quiz)

## Journal overhaul (requested Oct 9)
- [x] Daily scan record: every scan of the day saved, with which were taken vs skipped and outcome
- [x] One-click Log: captures entry, stop, TP and locks in to track outcome regardless of later edits
- [x] AI conversations + scans feed analytics/learning so the coach knows the user better

## Retention (Oct 9)
- Done: first-scan screen after onboarding, 8 AM NY morning picks email, 6 PM NY scanner wins email, email switches in Settings, daily profit email schedule + send record fixed.
