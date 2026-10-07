# Engineering rules

- Live entry prices come only from the model named in each signal's `entry_model`; switching an instrument requires an entry in `ENTRY_MODEL_V2_LIVE` (src/lib/entry-candidates.ts). Why: a silent entry-model swap went unnoticed for a week.
- Any change to entry logic must keep `tests/unit/entryGoldenSet.test.ts` green or regenerate `tests/golden/entry-windows.json` deliberately in the same change. Why: frozen windows catch accidental entry-price drift.
- Rules carry an evidence tier in `src/lib/analysis-models/evidence-tiers.ts`; only tier A may block, B may adjust grade/size, C/D record only, and tiers move only with a logged `rule_evidence` row. Why: stops untested assumptions becoming gating logic.
- Entry candidates are compared at equal risk and the same target, with unfilled orders scored 0R. Why: tighter inner levels otherwise inflate quoted R:R.
- The backtest rig (research/rig) must import setups only from `src/lib/detector/`; never reimplement detection there. Why: a research copy that drifts from live is the main cause of backtest/live disagreement.
- Rig runs must register their pre-registration before scoring and may open a holdout once per pre-registration (`research/rig/registry.ts`). Why: the comparison count and single-use holdout are inputs to the statistics.
