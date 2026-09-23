# Sep 10 calibration roadmap

- [x] Phase 0: Capture baseline metrics, fixtures, and authenticated screenshots
- [x] Phase 1: Calibrate top-down 1H order-block entries, wait states, stops, and A-grade rules
- [x] Phase 2: Add Auto-with-override trade style and target/timing calibration
- [x] Phase 3: Add screenshot-first journal review-before-save workflow
- [x] Phase 4: Simplify VWAP and close admin/chart operational gaps
- [x] Phase 5: Add versioned methodology, expert review, and command board
- [x] Phase 6: Add isolated deterministic paper-bot research harness
- [x] Phase 7: Complete release regression and authenticated acceptance report

## Acceptance run — Sep 11, 2026
- 678 automated tests pass across 37 files; typecheck clean.
- Signed-in pass over dashboard, journal, broker, admin, analytics, academy: all render, zero console errors.
- Live Gold scan produced a graded plan (C · long) with structural entry zone 4337.08–4351.70, buy limit 4344.39, stop 4283.47, TP1 4413.47 (1.1R), TP2 4458.18 (1.9R), auto-chosen playbook, trade style, session timing window, measured history hit rate, and a plain-language reason for the grade cap.
- Sidebar reads "Broker (TradeLocker)"; paper bots stay admin-only and clearly labelled.

## Closed out — Sep 11, 2026
- Replay results now carry a per-instrument status (Validated / Needs calibration / Not enough data) and an
  explicit warning listing instruments whose numbers must not be quoted. Positive expectancy over at least
  30 replayed trades is required before an instrument counts as validated.
- Backend permission warnings reviewed: every admin helper checks the caller's admin role before doing
  anything, and the only visitor-callable helper is the public leaderboard. Both warnings dismissed with reasons.

## Known open items
- None. Reviewed instruments still flagged "Needs calibration" are working data, not blockers: USD/JPY, US30,
  GBP/USD and BTC/ETH remain excluded from any published performance figure until replay turns positive.

## Scan Models page — Sep 20, 2026
- [x] Add a dedicated model library and account-level model selection.
- [x] Link the dashboard picker and desktop navigation to the model library.
- [x] Verify the route, selection behavior, type safety, and tests.

## Mobile dashboard cleanup — Sep 20, 2026
- [x] Move Scan Models under Insights.
- [x] Keep Auto Trading desktop-only and combine its mode and grade controls.
- [x] Reduce phone toolbar and signal-card crowding.
- [x] Verify responsive visibility rules and the full automated suite (58 files, 865 tests).
- [ ] Complete the signed-in visual pass when a preview account is available.

## Clock, news timing, one-question flashcard check — Sep 23, 2026
- [x] News write-up and chat calendar lines carry weekday, date and the current time
- [x] Chat also knows the trader's local time
- [x] Live moving clock with date and market status on the dashboard
- [x] Pre-scan check: one flashcard question, never repeat a correctly answered one, beginner -> intermediate -> advanced
- [x] Record every question asked and whether it was right; tests + browser check
