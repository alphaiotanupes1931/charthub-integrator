# Paper Trading + Daily Briefings + Kill Switch

Three connected features. All three can share the same paper-trading engine and the same Telegram delivery pipe.

## 1. Testing Mode (Paper Trading)

A toggle in Settings: "Testing Mode". When on, the app shows a persistent "TESTING" banner at the top and unlocks a paper account.

- Starting balance: $10,000 (configurable per user, default 10k).
- The AI (existing scanner + planner) auto-executes its A / A+ signals on the paper account: fills at the entry price, respects the stop and TP, closes at TP/SL touch.
- Fills are simulated against live OHLC (same feed the chart uses), so results reflect real market moves — no synthetic data.
- Position sizing uses the user's configured risk % per trade (already in Settings).
- Every fill, close, and equity change writes a row so the user can review history.
- A "Testing" page shows: current equity, open positions, closed trades, win rate, P&L curve, max drawdown, and a Reset button that wipes and restarts at $10k.

## 2. Kill Switch (10% drawdown from peak)

Runs inside the paper engine and — later, when live broker execution ships — the live engine too.

- Track the running peak equity per account.
- If equity drops ≥10% from peak: close every open position at market, block new AI trades, flip account status to `paused_for_review`.
- User gets an in-app alert + Telegram push explaining what happened and the drawdown number.
- Nothing resumes until the user hits "Resume trading" in the Testing page and acknowledges.

## 3. Morning + Evening Briefings via Telegram

Two scheduled jobs.

- **Morning (07:00 user local time):** overnight moves on their watchlist, any A/A+ setups the scanner found pre-market, upcoming high-impact news, and — if Testing Mode is on — paper account status.
- **Evening (21:00 user local time):** what actually happened today on the watchlist, closed paper trades with P&L, running week performance, mental-state prompt link.
- Delivery: Telegram DM to the user's chat via the existing Telegram connector.
- Setup flow in Settings → Notifications: user clicks "Connect Telegram", we show a link to `t.me/<bot>?start=<one-time-code>`, they message the bot, we store their `chat_id` against their profile.
- Also viewable in-app under a "Briefings" page so users who skip Telegram still get value.

## Technical notes

**Data model (new tables, all RLS-scoped to `auth.uid()`):**

```text
paper_accounts        one row per user; balance, peak_equity, status, starting_balance
paper_positions       open positions: symbol, side, entry, stop, tp, size, opened_at
paper_trades          closed trades: entry/exit/pnl/reason (tp|sl|kill_switch|manual)
paper_equity_snapshots  timestamped equity for the P&L curve
briefing_prefs        user_id, telegram_chat_id, morning_enabled, evening_enabled, timezone
briefings             sent briefings (kind, sent_at, body) so we can show in-app history
```

**Engine (server functions, not edge functions):**

- `src/lib/paper-engine.functions.ts` — `openPosition`, `closePosition`, `reconcileOpenPositions` (runs on a cron every 1m; checks live price vs stop/TP, updates equity, triggers kill switch).
- Reuses existing `runPlan` output as the trade source when a scan produces an A or A+ grade in Testing Mode.

**Scheduled jobs (pg_cron → TanStack public routes):**

- `/api/public/hooks/reconcile-paper` — every 1 minute during market hours.
- `/api/public/hooks/send-briefings` — every 15 minutes; picks users whose local 07:00 or 21:00 window matches now (uses `briefing_prefs.timezone`).
- Auth via `apikey` header (Supabase anon key), per project convention.

**Telegram:**

- Uses the existing Telegram connector via `standard_connectors--call_gateway_connection`.
- Bot receives `/start <code>` in a webhook route at `/api/public/telegram/webhook`, links `chat_id` to the user who generated the code.
- If the user hasn't linked Telegram yet, briefings still write to the DB and appear in-app; no send is attempted.

**UI:**

- `src/routes/_authenticated/testing.tsx` — paper account dashboard, reset, resume-after-kill.
- `src/routes/_authenticated/briefings.tsx` — history + on-demand "send me now" button.
- Settings additions: Testing Mode toggle, starting balance input, Telegram link flow, briefing time overrides.
- Dashboard banner component when `testing_mode = on`.

## Rollout order

1. DB schema + RLS + grants.
2. Paper engine + Testing UI + Settings toggle (no Telegram yet).
3. Kill switch inside the engine + resume flow.
4. Telegram connector wiring + link flow.
5. Briefing generator + pg_cron schedules.
6. QA: run testing mode against a couple of scanned setups, force a 10% drawdown to confirm the kill switch fires and pauses cleanly.

## Open question before I start

The Telegram connector needs to be linked to the project (one click on your side). Want me to kick that off after step 3, or set it up first so briefings are ready the moment the engine is done?
