# Engineering rules

- Live entry prices come only from the model named in each signal's `entry_model`; switching an instrument requires an entry in `ENTRY_MODEL_V2_LIVE` (src/lib/entry-candidates.ts). Why: a silent entry-model swap went unnoticed for a week.
- Any change to entry logic must keep `tests/unit/entryGoldenSet.test.ts` green or regenerate `tests/golden/entry-windows.json` deliberately in the same change. Why: frozen windows catch accidental entry-price drift.
- Rules carry an evidence tier in `src/lib/analysis-models/evidence-tiers.ts`; only tier A may block, B may adjust grade/size, C/D record only, and tiers move only with a logged `rule_evidence` row. Why: stops untested assumptions becoming gating logic.
- Entry candidates are compared at equal risk and the same target, with unfilled orders scored 0R. Why: tighter inner levels otherwise inflate quoted R:R.
- The backtest rig (research/rig) must import setups only from `src/lib/detector/`; never reimplement detection there. Why: a research copy that drifts from live is the main cause of backtest/live disagreement.
- Rig runs must register their pre-registration before scoring and may open a holdout once per pre-registration (`research/rig/registry.ts`). Why: the comparison count and single-use holdout are inputs to the statistics.
- Trader-type questions, scoring weights, coach/strategy/risk mappings and first-week tasks live only in `src/lib/trader-profile/config.ts`; screens and server code read from it. Why: Marcus tunes the rules without touching UI or server code.
- Quiz answers carry into signup via a server-stored short code (`quiz_drafts`) plus a localStorage copy, never URL-only. Why: Google sign-in and the separate marketing domain drop query strings and storage.
- Journal trades carry an immutable `lockedPlan` (src/lib/journal-lock.shared.ts) set on first save; the verify tick scores it separately from edited levels. Why: shows whether moving stops/targets helped or hurt.
- Coach trader memory is built deterministically from scans, journal and chats in `src/lib/trader-memory.shared.ts`, not by an extra AI call. Why: no per-message cost and it stays testable.
- Retention email timing and selection rules (morning picks, scanner wins) live only in `src/lib/retention-emails.shared.ts`; the cron route just reads them. Why: keeps send rules testable and in one place.
- New signups land on `/first-scan` after onboarding, before the dashboard. Why: every user sees and tracks one live setup in their first session.
