# Trader Type: onboarding (Phase 1) and public quiz (Phase 2)

Everything is built today, in order. Phase 1 comes first.

## What users will see

**New signup**
1. Sign up (email or Google), then the existing step for name and "how did you find us".
2. New step: "Find your trader type". The first screen offers two paths:
   - "Help me figure out my type": the full quiz with the 14 questions from the brief, one per screen, tap to answer, with a back button and progress bar.
   - "I already know my problem": pick the problem, market and style. Three screens.
3. "Your Setup" screen: trader type and a plain-English read, coach and why, 1–2 starter strategies, risk rails, and a 5-day first-week plan. Each item has a "Change" control. One line says "Recommendations are educational, not financial advice."
4. "Start my first week" applies everything, then the recovery code step, then the dashboard and tour.

**Someone who took the quiz first**
- Onboarding is already filled in. They go straight to "Your Setup" and never answer twice.

**Existing users**
- A one-time, skippable "Find your trader type" banner appears on the dashboard.

**Public quiz (Phase 2): "What's your trader type?"**
- New public page at `/quiz`, with no login. It is mobile-first and asks the same questions.
- They see a teaser result, then "Unlock your full setup" sends them to signup with their answers attached.
- Visitors can optionally enter just their email to get the result. Those leads go to GoHighLevel tagged `quiz-taker` and `quiz-<type>`.
- "Share my trader type" makes an image card for each type (1080x1350 and 1200x630) with the text "I'm The Stop Mover. What's your trader type?" and a link back with `?ref=`.
- UTM and ref links are kept from the quiz through signup to the first grade.
- go.trademindai.ai/quiz can link into the app with `?answers=<code>` to carry answers over.

## The rules (one config file, editable without touching the rest)
- Trader types, with blow-up habits winning ties: Comeback, Stop Mover, Gut, Second-Guesser. New Trader (under 6 months) and Overtrader are also included.
- Coach mapping, strategy mapping and risk defaults follow the brief's tables: 0.5% risk, 2% daily loss and grade A for new, anxious or Comeback traders; 1%, 3% and B+ for everyone else.
- Metals guard: metals-first traders never get a playbook flagged weak on metals. For now that means Breakout & Retest plus Supply & Demand, until Marcus confirms the table.
- Coach tone (straight, explain or encourage) and trader type are passed to every coach reply.

## Assumptions (change any of these after review)
- Events go through the app's existing tracking, not PostHog, because PostHog isn't in the app today. Event names match the brief.
- The questions and type write-ups come from the brief. The live standalone page's exact wording can be swapped in later through the config file.
- Strategy recommendations are a starting point until Marcus signs off.

## Technical details
- Migration: a `trader_profiles` table with a history of rows, holding source, answers, type, coach, tone, strategies, risk, accepted, ref and utm. RLS limits each user to their own rows, plus grants. A `quiz_drafts` table, insert-only for anon with short-lived codes, carries answers across domains and through Google sign-in. A `quiz_leads` table is server-write only.
- `src/lib/trader-profile/config.ts` holds questions, types, mappings and tie-breaks. `score.ts` is a pure function. `tests/unit/traderProfile.test.ts` covers every tie-break, the risk defaults and the metals guard.
- `<TraderProfileFlow mode="public|onboarding">` guards against double taps.
- Onboarding gains the profile step before the recovery code. "Start my first week" saves the profile and writes the account's risk rails to `autopilot_settings` (risk_pct, max_daily_loss_pct, min_grade) without enabling Autopilot. It also stores the coach and strategy on the account and in the browser.
- Coach chat reads the latest profile on the server and adds type and tone lines to the per-request prompt.
- First Week gets a 5-day plan driven by the profile on top of the existing tasks.
- Phase 2 adds a public `/quiz` route with its own head() tags, OG image server routes for each type, and a GoHighLevel server call (upsert, then tags in a second call). This needs GHL API key and location ID secrets, which will be requested.
- Draft answers are claimed after signup, including the localStorage `tm_profile_draft`, then written to `trader_profiles`.
