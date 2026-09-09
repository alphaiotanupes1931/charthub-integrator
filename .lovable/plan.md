# Auto Trading toggle on the home page, live-only

## What you get

**1. An "Auto Trading" toggle on the home page**

A single control at the top of the dashboard with two states: **Manual** and **Auto**.
Next to it, a small setting: *Ask me when a setup is graded ___ or better* (A+, A, or B — your choice).

**2. Scan finishes, popup asks**

When a scan comes back at or above your chosen grade and the platform is recommending the trade:

- **Auto** is on -> a popup appears: instrument, direction, entry, stop, target, grade, position size, and the risk in dollars. Two buttons: **Place this trade** or **Skip**.
- **Manual** -> no popup ever. Nothing is placed. You still see the plan as you do today.

This happens on every qualifying scan, not just the first one.

**3. No broker connected? The popup tells you**

Flipping the toggle to Auto without a connected broker shows: "You haven't connected a broker yet" with a **Connect a broker** button that takes you to the broker page. The toggle stays on Manual until a broker is connected. Once connected, flipping to Auto works.

**4. Trades you accept get managed for you**

After the order fills at your broker:
- Stop and target are attached at the broker immediately.
- Part of the position closes at the first target.
- The stop moves to break-even once the trade is ahead by the amount it was risking.
- The remainder trails behind structure toward the second target.
- Every action is logged so you can see what the platform did and when.

**5. The broker page becomes a broker page**

It becomes: connect a broker, sign out of a broker, and pick your **default broker** (the one auto trading uses). Your live positions and the manual order ticket stay — the settings and rails that used to live scattered around move into the auto trading panel.

**6. Practice trading is removed**

No practice account anywhere: no practice balance, positions, or trade history; the practice leaderboard and scoreboard are retired. Everything is live-broker only. Existing practice records stay in the database untouched but are no longer shown or written to.

## Technical outline

- `src/lib/autopilot.shared.ts`: drop `accountTarget` from settings and rails; modes reduce to `manual` and `auto` (`confirm` folded into the popup flow). Add `minGrade` already present; add `partialAtTp1` / `trailAfterTp1` management flags.
- Migration: default `account_target` to `live`, add `manage_partials boolean` and `trail_after_tp1 boolean` to `autopilot_settings`; no drops.
- New `src/components/AutoTradingToggle.tsx` (dashboard header) — reads settings via `getAutopilotSettings`, writes via `updateAutopilotSettings`, and checks `getBrokerStatus` before allowing Auto; renders the "connect a broker" dialog when not connected.
- New `src/components/TradeOfferDialog.tsx` — driven by the scan result already in `_app.dashboard.tsx`: shows plan + computed units, calls a new `placeAutoTrade` server fn (wraps `placeLiveOrder` in `autopilot-live.server.ts` with rails from `evaluateRails`) and logs via `logAutopilotEvent`.
- Position sizing: reuse the risk-sizing logic from `buildProposalDraft` (`autopilot.server.ts`), fed by live account equity from `broker-readonly.server.ts` instead of paper balance.
- `autopilot-live.server.ts`: extend `manageLiveTrades` with a partial close at TP1 (`/trades/{id}/close` with units), break-even stop, and a structure-based trailing stop for the remainder.
- `autopilot-run.server.ts`: remove the `autoFill`/paper branch and `dailyLossPct`'s paper dependency (compute daily loss from broker closed trades); live path only.
- Remove paper surfaces: `paper-engine.functions.ts`, `paper-engine.server.ts`, `fillAutopilotProposalOnPaper`, `api.public.hooks.reconcile-paper.ts`, `_app.leaderboard.tsx`, `_app.scoreboard.tsx` paper sections, paper blocks in `_app.analytics.tsx`, `LivePerformancePanel.tsx`, `weekly-review.server.ts`, `briefings*`, `entitlements.ts`, `AppShell` nav, and tour/instruction copy.
- `_app.broker.tsx`: add default-broker selection and a disconnect action (`broker-credentials.functions.ts`); keep positions + order ticket.
- `_app.autopilot.tsx`: trimmed to rails, event log, and trade-management options — no paper/live account switch.
- Tests: update `autopilotLive.test.ts`, add coverage for grade-gated offers, no-broker gating, and partial/trail management.
