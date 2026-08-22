# Permanent free tier — phased build

Replaces the 7-day trial with a permanent free tier: 3 signal grades per calendar month, journal / risk calculator / alerts / Academy basics free forever, coaching layer and Analytics paid. Everything ships behind the `free_tier_enabled` flag so it can be turned off without a deploy.

## Phase 0 — Flag, entitlement model, migration safety (highest risk first)

- Feature flag `free_tier_enabled` stored in the database (single settings row, admin-togglable, read server-side). Off = today's behaviour exactly, including trial checkout.
- One entitlement resolver on the server that returns the caller's tier (`free | basic | pro | elite | admin`) plus capability booleans. Every gate reads this one place; no page invents its own rule.
- Paid accounts: a paying subscription short-circuits the resolver before any quota code runs — no quota counter, no paywall, no preview state anywhere. This is the regression that matters most, so it gets its own test file.
- Mid-trial accounts: keep full access until their original trial end date, then resolve to free. No shortening, no revocation.
- Expired-trial and brand-new accounts resolve to free with a full 3 grades in the current month.
- Tests: paid untouched, mid-trial retains access through end date then drops to free, expired-trial lands on free with 3 grades, flag off restores current behaviour.

## Phase 1 — Grade quota mechanics

- Monthly quota table keyed by user + month, reset at 00:00 on the 1st in the account timezone (UTC fallback).
- A grade is consumed only when a scan successfully returns a graded setup. A legitimate "No Entry" answer counts. Failures, timeouts, upstream feed errors, 5xx, and internal no-result cases never decrement.
- 10-minute debounce on identical instrument + timeframe + methodology: returns the cached result, charges nothing.
- Quota is decremented server-side after the result is produced, so a client crash can't burn a unit.
- Tests: 3 then blocked, forced 5xx does not decrement, identical re-run inside 10 minutes returns cached and does not decrement, "No Entry" does decrement, month rollover resets, paid accounts never touch the counter.

## Phase 2 — Quota UI and the grade-#4 paywall

- Quiet remaining-count line near Run Scan, shown from the first grade: `2 of 3 grades left this month`. Not shown to paid accounts.
- At zero the Run Scan control stays visible and normal-looking; clicking opens the paywall.
- Paywall: one modal screen, no scroll, spec copy verbatim including the closing line about journal / alerts / Academy staying free. Dismissible by Escape, click-outside and a close control. Shown at most once per session; later clicks show a one-line inline message.
- No countdowns, no expiring offers, no strikethrough pricing, no scarcity of any kind.

## Phase 3 — Analytics preview (the conversion mechanism)

- Analytics stays in the nav for free users and opens a real page.
- Free state shows the user's true journalled-trade count, the spec's description of what Analytics reveals, the Basic price, and both CTAs, with the real chart rendered blurred at low opacity and no legible values.
- Zero journalled trades: an empty state that prompts journalling instead. Never "0 trades" beside an upgrade ask.
- Paid accounts see the normal Analytics page with no preview chrome.

## Phase 4 — Capability gating for the rest of the table

- Coaches, Academy modules beyond Trading Basics, Signal Engine, Strategy Library, Trading Memory, briefings/delivery, broker paper/live, Autopilot gated from the Phase 0 resolver per the spec table.
- Journal, risk calculator, alerts, Academy basics, flashcards and Discord stay reachable at quota zero — verified by test.

## Phase 5 — Copy, sequencing, instrumentation

- Remove every trial string from the app: pricing page, signup flow, landing page, FAQ, help articles, guide, and any transactional email referencing trial start/end. "7-day free trial" becomes "Start free".
- Pricing page gains a Free column listing the spec contents in full.
- Stripe checkout stops sending `trial_period_days` when the flag is on.
- PostHog events exactly as specced, including `days_on_free`, `grades_used_lifetime` and `journalled_trade_count` on conversion.
- Ships in the same turn as Phase 2/3 go live so the site never advertises a trial that doesn't exist.

## Blocked on Marcus (§13)

These land in Phase 4 once answered; the architecture doesn't change either way:
1. Basic-tier coach count and which two — building the gate as a configurable allow-list so the answer is a config change.
2. Strategy Library titles visible-but-locked for free, or hidden entirely — building to the spec's recommendation (titles shown, win rates hidden) unless told otherwise.
3. Inference-cost ceiling on 3 grades/month — the number lives in one config constant, tunable without a rebuild of the quota logic.

## Technical notes

- New tables: `app_flags` (flag state), `free_tier_quota` (user + month + grades used + timezone snapshot), `scan_debounce_cache` (or reuse of the existing scan cache keyed by instrument+timeframe+methodology). All with GRANTs and owner-scoped RLS; flag readable by all signed-in users, writable by admins only.
- Entitlement resolver added to the existing `access-gate` server-function module and consumed by a single client hook, so gating can't drift page to page.
- Quota accounting happens in the scan server path after grading succeeds, not in the client, and is skipped entirely for paid and admin accounts.
- Each phase ships with vitest coverage in `tests/unit`, matching the §12 acceptance criteria one-for-one, plus a check that no "7-day trial" string remains anywhere in the app.
