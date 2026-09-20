# Switchable analysis models

Turn the single analysis brain into named, switchable models — the way you pick a model in ChatGPT. Each model is defined by what it is fed: its strategies and rules. Nothing else about the app changes.

## The models

**Model 1 — "TradeMind Classic"**
Everything the coach and scanner are fed today: the full pattern and strategy library, order-block and protected-structure logic, instrument behaviour notes, journal and news context. No behaviour change at all — it is exactly what you have now, just given a name and a version label so results can be attributed to it.

**Model 2 — "TradeMind Focus" (working name, yours to rename)**
Fed only the strategies you give me. No pattern library, no extra presets, nothing inherited from Model 1. Same as the Wyckoff mode approach: a clean, written-down rulebook that the AI is only allowed to narrate, never override. I will build it empty and ready, then fill it with your strategies when you send them.

## How switching works

- A model picker sits next to the chat, available to every user, remembered per account.
- The picked model drives both sides: the coach's analysis and answers, and the scanner's grades, entries, stops and targets.
- Every scan and every filed signal records which model produced it, so the track record never mixes them. Old records stay labelled Model 1.
- The scoreboard and record pages gain a model filter, so Model 1 and Model 2 are always judged separately and never pooled.

## What stays deterministic

Direction, entry, stop, target and grade still come from code, not from the AI. A model only changes which rules that code checks and which knowledge the coach is handed. The AI still narrates.

## Order of work

1. Model registry: names, versions, and the knowledge each model is fed. Model 1 wired to today's content with no behaviour change.
2. Record the model on every scan and filed signal; label all existing history as Model 1.
3. Model picker in chat, saved per account, applied to coach and scanner.
4. Model 2 shell: its own rulebook file and engine path, empty until your strategies arrive.
5. Model filter on the scoreboard and public record so the two are never compared as one number.
6. When you send the strategies: write them into Model 2's rulebook, wire the checks, test, then run both side by side.

## Technical notes

- New `analysis_models.ts` registry (id, display name, version, knowledge bundle, engine path) as the single source of truth; `api.chat.ts` builds its system block from the selected model instead of importing the knowledge directly.
- Model 2 reuses the `src/lib/wyckoff` pattern: a versioned rulebook module plus a pure deterministic engine, so it stays isolated from the Classic planner.
- Migration adds nullable `model_id` / `model_version` to `signal_scores` and scan history, backfilled to `classic-1.0`; filing path and `signal-scores.functions.ts` persist the active model.
- Per-account selection stored on the profile; scanner server functions take the model id as an explicit argument rather than reading global state.
- Scoreboard aggregation gains a model dimension alongside the existing grade denominators; existing decided-only rules unchanged.

## Open question

Model 2 has no strategies yet, so it cannot produce signals until you send them. I will build it as a labelled, clearly empty model rather than guessing content for it.
