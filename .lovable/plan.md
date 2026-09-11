# Plan — Sep 10 meeting: entry precision, order-block focus, TP calibration, system docs

From the Sep 10 call with Marcus: signals are giving direction right but entries are too early
(stop hit, then the trade does exactly what was called). The ask: make the entry engine hunt
the *right* 1H order block like a human doing top-down analysis, keep A-grades sniper-grade,
fix take-profits that are too far out, handle the "everything is bearish but a big retracement
is coming first" case, and document what data the system actually uses so rules can be tuned.

## 1. 1H order-block-first entries (the core ask)

- Entry selection today uses order blocks but also falls back to bare levels. Make the 1H
  order block the primary entry zone: a trade only gets an entry when price is inside or
  approaching a fresh, unmitigated 1H order block in the trade direction.
- Rank order blocks by quality: unmitigated (untouched since formation), formed on displacement
  (strong impulse away), aligned with the 4H bias, and near liquidity that was just swept.
- When no qualifying 1H order block exists near price, the scan returns "no entry yet — wait
  for pullback into the 1H order block at [zone]" with the zone named, instead of forcing a
  shallow limit at a weak level.
- 15-minute confirmation stays as the trigger inside the zone; entry is placed in the order
  block with the stop beyond the block's far side plus buffer.

## 2. Anti-chase / drawdown reduction

- Reject or flag entries where price has already moved more than ~0.5 ATR away from the order
  block ("too early / too late" guard) — the failure Marcus described was entering way too early.
- Add a "wait state": when the plan is valid but the entry zone hasn't been reached, the scan
  says so and names the zone and the trigger, rather than grading a market-order entry.

## 3. Take-profit calibration

- TPs are already structure-based (swings, opposing order blocks, liquidity pools). Recalibrate:
  cap TP1 at the nearest level within a timeframe-scaled ATR reach (e.g. 1.5 ATR of the scan
  timeframe) so TP1 is realistic; TP2 stays the next structure beyond.
- If the nearest real structure is further than the reach cap, say "no reachable structure
  target — expect a runner / manage manually" instead of printing a fantasy TP.

## 4. Retracement-first scenario

- When the higher-timeframe bias is one direction but lower-timeframe structure shows a pending
  retracement (price stretched from the zone, opposing 1H order block / unmitigated FVG above
  or below), the plan must say: direction X, but expect pullback toward [zone] first — do not
  enter at current price. This addresses "everything is bearish on gold but a big retracement
  is about to happen before it comes down."

## 5. A-grade = sniper

- Tighten the A threshold: A requires 4H alignment + entry at a quality 1H order block +
  15m confirmation available + no opposing flow + no near-term news + reachable structure TP.
- Anything missing a quality order-block entry caps at B (shown in the "why this grade" panel
  with the named reason), keeping the explanation UI Marcus liked.

## 6. System documentation page

- Add an admin "How it works" page documenting, in plain language: what data feeds the engine
  (candles per timeframe, order flow/delta, volume, sessions, news calendar), what the bias
  engine computes, how the grade is built from counted evidence, every grade-cap rule, and how
  entries/stops/TPs are placed. Written so non-engineers can follow, so tuning conversations
  ("loosen this rule") have a shared reference.

## Technical notes

- All changes in the deterministic engine: `src/lib/agents/planner.server.ts` (entry anchoring,
  grade caps, wait-state), `src/lib/orderBlocks.ts` (block quality scoring), and the scan
  route. AI narration only describes what the engine decided — no behavior from prompts.
- New tests: order-block entry selection, too-early rejection, retracement-first wording,
  TP reach cap, A-grade tightening. Run existing suite (640+ tests) to catch regressions.
- Docs page as a new route under the admin section; no database changes needed.

## Verification

- Unit tests for each rule plus full Vitest run and typecheck.
- Replay the Sep 8–9 USD/JPY-style failure shape against the new entry logic to confirm it now
  waits for the order block instead of entering early.
