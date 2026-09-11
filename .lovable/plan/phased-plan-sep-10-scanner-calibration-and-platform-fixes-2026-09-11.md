# Phased plan — Sep 10 scanner calibration and platform fixes

The order is based on the meeting's main decision: pause new live-automation work until the
scanner is trustworthy. Each phase ends with automated checks and an authenticated test-account
walkthrough before the next phase starts.

## What is already present and should be verified, not rebuilt

- Deterministic bias, grade caps, confidence, counter-trend/news/stale-data protection, and the
  visible “why this grade” panel.
- Structure-based targets, trade-duration guidance, signal TP/SL resolution, the scorecard,
  chart markup tools, chart-image journal attachments, broker-reported P&L, and admin usage views.
- Auto strategy selection and early 1H order-block entry preference exist, but they need the
  stricter calibration and regression coverage below.

## Phase 0 — Freeze a measurable baseline

- Record current A/B/C frequency, target rate, stop rate, expectancy, maximum drawdown, and
  no-entry rate by instrument, timeframe, session, and strategy. Keep live and replay results
  separate.
- Create fixed replay fixtures for the failed USD/JPY trade and representative Gold, NAS100,
  US30, SPX500, BTC, and ETH cases discussed in recent meetings.
- Save the current test-account scan cards, chart annotations, journal extraction, and admin
  screens as the before-state.
- Define promotion rules before tuning: no phase ships if it improves one instrument while
  materially degrading the rest, or if A trades fail to outperform B trades in the test set.

**Test-account gate:** Run the existing full suite, scan the named instruments, confirm current
grade explanations and outcome tracking, and save screenshots plus scan IDs for comparison.

## Phase 1 — Rebuild entries around the complete top-down method

- Enforce the cascade Marcus described: Daily and 4H establish direction; a closed 4H candle and
  1H break of structure establish the setup; a fresh 1H order block establishes the entry zone;
  15m confirms inside that zone; 5m refines the actual entry when data is available.
- Score candidate 1H blocks by freshness, mitigation count, displacement strength, structural
  break, higher-timeframe alignment, liquidity sweep, and distance from current price. Prefer
  order blocks over FVGs and bare levels; weaker structures remain supporting evidence only.
- Introduce an explicit wait state. If price has not reached the selected block or lower-timeframe
  confirmation is missing, show the zone and trigger instead of forcing an entry.
- Add anti-chase and anti-early-entry rules based on measured ATR/pullback profiles. Stops sit
  beyond the chosen block or confirmed swing with the instrument-specific buffer.
- Detect retracement-first conditions: preserve the higher-timeframe direction but clearly say
  that price must pull back to the named zone before entry.
- Require a quality 1H block, Daily/4H agreement, 15m confirmation, supportive flow, acceptable
  news risk, and a reachable structural target for an A grade. Missing the block caps the setup
  at B; unresolved directional conflict remains C or no entry.

**Test-account gate:** Replay every fixed case, then scan live Gold, NAS100, US30, and one FX pair.
Verify the selected 1H block visually with “Show Me,” confirm wait states do not present actionable
orders, and compare grade distribution and drawdown against Phase 0.

## Phase 2 — Make targets and trade style match the market

- Keep targets structure-first: TP1 is the nearest reachable opposing swing, liquidity pool,
  order block, or supply/demand boundary; TP2 is the next distinct structure. R:R reports target
  quality but never invents target placement.
- Reject fantasy targets beyond the timeframe's measured reach. When no real level is reachable,
  say so instead of manufacturing a TP.
- Add `scalp`, `intraday`, and `swing` classification using timeframe, volatility, session,
  structure distance, and measured instrument behavior.
- Use **Auto with override**: recommend the best style for current conditions while allowing the
  trader to choose a different style before scanning.
- Show expected entry window, likely TP1/TP2 duration range, anticipated chop, cancellation time,
  and management guidance appropriate to the selected style. Do not present clock estimates as
  guarantees.

**Test-account gate:** Run the same symbol in Auto, Scalp, Intraday, and Swing modes. Confirm each
mode changes eligible setups, targets, and timing coherently without changing the underlying
higher-timeframe direction.

## Phase 3 — Make screenshot journaling accurate and fast

- Redesign the journal around paste/drag/drop first; keep upload and manual entry available but
  visually secondary.
- Parse broker position screenshots, marked-up charts, and pasted trade text into a normalized
  draft that preserves exact broker P&L, fees, entry, exit/current price, stop, targets, size,
  direction, and instrument without guessing missing values.
- Use **review then save**: show the screenshot beside extracted values, flag uncertain fields,
  let the trader correct them, and only then create or update the journal record.
- Benchmark the current image reader against the strongest available model on a fixed screenshot
  set. Switch models only if measured field accuracy improves; do not move the whole platform to
  another model based on assumption.
- Keep all uploaded and marked-up chart images attached to the trade and available in the existing
  full-screen viewer after reload and on another device.

**Test-account gate:** Test a broker position card, full TradingView markup, cropped screenshot,
multi-image trade, pasted fill text, and deliberately ambiguous image. Verify exact $50-style P&L,
corrections, cloud persistence, and no duplicate journal entries.

## Phase 4 — Simplify charts and close operational gaps

- Simplify the setup-view VWAP to one primary VWAP line by default. Put bands and moving averages
  behind optional controls, lower their visual emphasis, and preserve selections across navigation.
- Verify setup labels and drawings persist when switching Live/Setup and returning.
- Verify the MNWFX2 admin role appears reliably in the sidebar and direct admin access is actually
  protected; remove any temporary “visible to all users” behavior.
- Separate real customers from test/debug accounts in admin reporting without deleting test data,
  and verify suspicious account-email display using the authoritative account record.
- Verify existing inactive-user emails and signal-resolution jobs rather than rebuilding them;
  repair only failures found in delivery/log checks.

**Test-account gate:** Navigate repeatedly between Live and Setup, toggle VWAP options, reload,
and confirm visual persistence. Test admin and non-admin accounts separately, including direct URL
access, sidebar visibility, customer filtering, emails, and resolved trade notifications.

## Phase 5 — Create a shared, auditable methodology and trader-review workflow

- Add an admin “How the scanner works” page covering every input, data source, timeframe role,
  order-block definition, evidence count, grade threshold/cap, wait state, stop rule, target rule,
  timing estimate, and outcome measurement in plain language.
- Version the methodology so every saved scan identifies the rules used to produce it.
- Build the selected **expert review workflow**: Marcus or another approved reviewer can inspect a
  replayed setup, see the original candles/levels and engine decision, approve/reject it, identify
  the correct block/entry/stop/target, and leave a note.
- Store review decisions separately from live performance. Use them to create regression fixtures;
  never let free-form reviewer notes silently alter production rules.
- Add a compact command board showing meeting actions as `planned`, `building`, `testing`,
  `approved`, or `blocked`, with phase and owner, so completed and newly raised work stays visible.

**Test-account gate:** As admin, review and annotate fixtures; as a normal user, confirm the review
tools are inaccessible. Verify methodology versions and review notes survive reload and that a
reviewed case can be promoted into a repeatable test.

## Phase 6 — Research and paper-test deterministic trading bots

- Build a paper-only evaluator around the same deterministic scanner. AI explains results but does
  not choose direction, entries, stops, or targets.
- Run bots by instrument/style through historical replay and controlled forward paper testing.
  Record every decision, skip, fill, management action, and outcome for reproducibility.
- Compare the current single-engine approach with specialist deterministic checks for structure,
  flow, news, and risk. Do not create an expensive multi-agent system unless the measured result
  beats the simpler engine.
- Keep this isolated from funded accounts and existing live automation until the scanner passes
  agreed sample-size, expectancy, drawdown, and A-versus-B performance thresholds.

**Test-account gate:** Start, pause, resume, and inspect a paper bot; verify no live broker order can
be created, results are reproducible, and the journal/scoreboard clearly labels all bot data as
paper testing.

## Phase 7 — Release readiness and ongoing cadence

- Run the full automated suite, fresh-data live scans, all authenticated role checks, and mobile/
  desktop walkthroughs. Check the signal engine, journal, charts, admin, emails, and paper testing.
- Publish a phase report after every phase: completed items, before/after metrics, screenshots,
  regressions, open blockers, and the exact next phase. No phase begins until its test-account gate
  passes.
- Keep marketing claims, published hit rates, testimonials, and content tied only to measured live
  results with clear sample sizes. Do not mix replay, paper-bot, or manually reviewed outcomes into
  customer-facing performance.

## Technical boundaries

- Trading decisions remain deterministic TypeScript. AI may parse screenshots, summarize evidence,
  and explain a decision, but prompts cannot override direction, grade, entry, stop, or targets.
- Likely core changes: order-block scoring and planner logic, trade timing/style classification,
  journal extraction/review UI, chart VWAP rendering, admin authorization/reporting, methodology
  versioning, and expert-review/paper-test storage.
- Any new review or bot tables ship with explicit grants, row-level protection, admin/user policies,
  and an audit trail. Live and test performance remain separate by design.
