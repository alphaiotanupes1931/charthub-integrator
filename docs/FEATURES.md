# TradeMind — Complete Feature Documentation

Every feature in the platform, what it does, who can use it, and which code powers it.

Companion document: `docs/AI-AND-SCANNER.md` explains exactly what data feeds the AI coach and the scan grading engine.

---

## 1. Plans and access

Four tiers: **Free**, **Basic**, **Pro**, **Elite** (`src/lib/entitlements.ts`).

| Capability | Free | Basic | Pro | Elite |
| --- | --- | --- | --- | --- |
| Trade journal | Yes | Yes | Yes | Yes |
| Risk calculator | Yes | Yes | Yes | Yes |
| Price alerts | Yes | Yes | Yes | Yes |
| Academy basics + flashcards | Yes | Yes | Yes | Yes |
| Community | Yes | Yes | Yes | Yes |
| Chart grades per day | 2 | Unlimited | Unlimited | Unlimited |
| Performance analytics | — | Yes | Yes | Yes |
| Full Academy curriculum | — | Yes | Yes | Yes |
| Multi-instrument signal engine | — | — | Yes | Yes |
| Strategy library (with stats) | — | — | Yes | Yes |
| Trading memory | — | — | Yes | Yes |
| Daily briefings | — | — | Yes | Yes |
| Paper broker | — | — | Yes | Yes |
| Live broker trading | — | — | — | Yes |
| Auto Trading (autopilot) | — | — | — | Yes |
| Coach personas available | 1 | 2 | 6 | 6 |

How the limits are enforced:

- Every page behind `/_app` requires a signed-in account (`src/routes/_app.tsx`).
- The UI hides locked features with `CapabilityGate` (`src/components/CapabilityGate.tsx`) and shows `UpgradeModal`.
- The same rules are re-checked on the server before any paid action runs (`src/lib/capability-guard.ts`, `src/lib/capability-middleware.ts`), so a locked feature cannot be reached by calling the backend directly.
- Free daily grade count: `FREE_GRADES_PER_DAY` in `src/lib/entitlements.ts`, surfaced by `FreeTierUsagePanel` and `QuotaBadge`.
- Admin accounts (a row in `user_roles` with `role = admin`) resolve to Elite with no quota.
- Chat has its own daily safety caps: 100 AI messages and 5 image uploads per account per day (`src/routes/api.chat.ts`).

---

## 2. Scanning workspace

### Dashboard — `/dashboard` (`src/routes/_app.dashboard.tsx`)
The main screen. Contains:

- **Live chart tab** (default) and **Setup tab**, both using the TradingView-style panel (`TradingViewChart.tsx`) with the drawing rail: trend lines, rays, horizontal/vertical lines, rectangles, arrows, Fibonacci, measure tool, text, brush, eraser, magnet snap, lock/hide, colour, undo, clear. Symbol search, indicators, date ranges, watchlist, save-image and popout.
- **Native chart** (`NativeChart.tsx`) for the demo/marketing charts and lesson charts.
- **Scan / grade action** — runs the full analysis stack and returns a graded plan (grade, bias, confidence, entry zone, stop, TP1, TP2, R:R, playbook, trade style, methodology version, hit rate, and the reasons the grade was capped).
- **Grade reasons panel** — every rule currently limiting the grade, the binding one, and what has to clear for a better grade.
- **Coach chat panel** (`DashboardChatPanel.tsx`) — ask questions about the scan in context.
- **Buy / Sell bar** (`ChartTradeBar.tsx`) — places a live broker order using the scan's planned entry, stop and target. Disabled until a scan exists; shows estimated cost, required funds, insufficient-funds guidance, a funding link, a re-check button and an order confirmation with fill price.
- **Scan stamp and version history** (`ScanStamp.tsx`, `ScanVersionHistory.tsx`) — data source, fetch time, candle count, reference price and methodology version for auditability.
- **Today's recommendation**, **strategy preset card**, **next-scan bar**, **level warnings**, **instrument and strategy edge panels**.
- Changing the instrument clears the previous analysis and opens a fresh, instrument-titled chat thread.

### Scan lens — `/scan-lens`
Chooses the analysis emphasis applied to chart reads (`src/lib/scanLens.ts`).

### Risk calculator — `/calculator`
Position size and risk per trade. Free.

### Signals — `/signals` (Pro+)
Scans multiple instruments on demand and lists actionable setups (`src/lib/agents/signal-engine.functions.ts`, `sniper.functions.ts`).

### Strategies — `/strategies`, `/strategies/$strategyId` (Pro+ for stats)
Playbook library with measured per-strategy performance (`src/lib/strategy-perf.functions.ts`). Auto-selection logic lives in `src/lib/strategyAuto.ts` / `src/lib/agents/strategy-auto.server.ts`.

### Price alerts — `/alerts` (Free)
Create and manage price alerts; a scheduled job checks them every minute and sends an in-app notification on a cross.

### News — `/news`
Economic calendar and market write-up plus a dedicated news Q&A chat (`src/routes/api.news-chat.ts`).

---

## 3. Trade journal — `/journal`

- Log trades manually, or **upload a TradingView screenshot** (up to five timeframe images) and let the AI read entry, stop, target, size, direction and broker-reported net P&L.
- Separate **"Or paste trade text"** box with a "Fill fields from text" action; pasted text is also appended to notes.
- Clipboard paste support for both images and text.
- Screenshots are stored, thumbnailed and open in a full-screen lightbox with previous/next.
- **Net P&L from broker** field preserves the broker's exact figure rather than a recalculated one.
- **Mental state panel** — tag emotional state per trade; correlated with P&L in `journal-intel.functions.ts`.
- **Level validation warnings** when logged levels look inconsistent.
- **Automatic trade monitoring** — a scheduled verifier checks unresolved trades against real price history every 15 minutes and writes the outcome (target/stop, exit price, R multiple) back to the journal and calendar.
- **Cloud sync** of local trades (`journal-sync.ts`), CSV export, and a full personal data export (`privacy.functions.ts`).
- **Journal review panel** — AI review of recent trades.
- Conversations in chat can be staged straight into the journal (`chat-to-journal.ts`).
- Daily check-in reminder job nudges you to complete yesterday's trades.

---

## 4. AI coach and chat

- **Chat** — `/chat`, `/chat/$threadId`. Streaming conversation with thread sidebar, create/delete/archive, PDF export of a thread, voice playback of replies, and an **AI context inspector** showing exactly which prior scans were handed to the model.
- Thread titles are the instrument of the scan; switching instruments starts a new thread.
- **Coaches** — `/coaches`. Multiple coach personas; how many you can use depends on your tier.
- **Coach dashboard** — `/coach-dashboard`, **Mentor mode** — `/mentor`, **Voice coach** — `/voice-coach` (speech in, spoken replies out).
- Error states are explicit: if the AI provider is out of credits or rate-limited you see a clear message instead of a silent empty reply.

What actually feeds the coach is documented in `docs/AI-AND-SCANNER.md`.

---

## 5. Academy and learning

- `/academy` — module list and progress.
- `/academy/$moduleId`, `/academy/$moduleId/$lessonId` — lessons with interactive charts.
- `/academy/exam` — module quizzes; `/academy/review` — spaced review of missed items.
- `/academy/certificate/$moduleId` and `/academy/master-certificate` — completion certificates.
- `/flashcards` — free flashcard drills.
- `/guide` — in-app how-to reference. `/help`, `/help/$slug`, `/faq` — help centre.

Basics are free; the full curriculum requires Basic or above.

---

## 6. Performance and accountability

- **Analytics** — `/analytics` (Basic+). Win rate, expectancy, results by grade, instrument and session. Free accounts see a preview.
- **Scoreboard** — `/scoreboard`. Measured hit rate of the platform's own signals, split by grade, and split before/after the engine fix date (`src/lib/signal-engine-version.ts`) so old and new engine results are never mixed.
- **Levels** — `/levels`. Trader progression.
- **Leaderboard** — `/leaderboard`. Community ranking.
- **Trading memory** — `/memory` (Pro+). Patterns the platform has learned about your trading.
- **Weekly review** — an automatic weekly performance report per trader.
- **Daily briefings** (Pro+) — morning and evening AI briefings delivered at your local hour, optionally to Telegram.

---

## 7. Broker connections and trading

### Broker — `/broker`
Connect and manage accounts:

- **TradeLocker** (preferred) — sign in once, session held encrypted server-side; account selection, quotes, margin, orders with attached stop and target.
- **OANDA** — live accounts only (practice/demo rejected), read-only balance/equity/positions/recent closes plus live orders.
- **Alpaca** — OAuth connect at `/broker/alpaca/callback`.
- **Desktop bridge** — a local process claims queued orders for platforms without a public API (`/api/public/bridge`).
- **Import closed trades** from TradeLocker history into the journal.
- Read-only account panel shows balance, equity and open positions without any order permissions.
- Credentials are encrypted with AES-256-GCM (`src/lib/broker-crypto.server.ts`) and never exposed to the browser.

### Manual orders
From the dashboard trade bar only, and only after a scan. Shows estimated price, units, required funds, and clear messages for insufficient balance or an instrument your account cannot trade.

### Auto Trading — `/autopilot` and the dashboard toggle (Elite only)
- Manual / Auto toggle on the home page (`AutoTradingToggle.tsx`); Auto without a connected broker prompts you to connect one.
- Live only — no paper trading is exposed to traders.
- When Auto is on, qualifying setups are placed with attached stop and target, even while the app is closed (scheduled `autopilot-tick` job).
- Post-fill management: break-even at 1R, partials, and trailing — applied **only** to positions the platform opened itself (tagged internally). Positions you opened manually are never touched.
- Risk rails: risk percent per trade, timing rules, grade and confidence floors.
- Every proposal and action is logged for audit (`autopilot-events.server.ts`).
- `/testing` — sandbox surface for verifying behaviour.

---

## 8. Community and growth

- **Landing page** — `/`, with the 3D market-tape background, ticker tape, pricing teaser and FAQ.
- **Newsletter / email capture** on the landing page; the welcome email is queued immediately.
- **Free-plan email drip** — welcome, education and upgrade stages, with a TradeMind-branded unsubscribe page at `/unsubscribe`.
- **Pricing** — `/pricing`, Stripe Checkout. Free is permanent at $0/month with 2 daily grades; paid card signups get a 7-day trial.
- **Onboarding** — `/onboarding`, including recovery-code generation.
- **Auth** — `/auth` (email, username, Google), `/forgot-password`, `/reset-password`, recovery-code redemption.
- **Referrals** — `/friends`, `/invite/$code`.
- **Discord** — `/discord` plus an automatic community feed of A/A+ signals.
- **Telegram** — link a chat with `/start CODE` for briefings and alerts.
- **Contact / support** — `/contact`.
- **Legal** — `/privacy`, `/terms`, `/cookies`.
- **Status** — `/status`, a public health and version page.

---

## 9. Admin console — `/admin` (admin accounts only)

Tabs and panels:

- **Profit** — Stripe subscriptions, customer revenue table, background/system AI spend kept separate from per-user cost.
- **AI usage** — per-user averages, cost trends, per-user usage drawer, provider billed cost.
- **Image usage** — screenshot/image generation volume.
- **People & settings** — user overview, account controls, platform status banner control, support requests.
- **Scanner methodology** — the governance panel: methodology version, engine replay results with validation states (`validated`, `needs-calibration`, `insufficient-data`, minimum 30 trades and positive expectancy), instrument profile measurement/refresh, and plan debugging.
- **Paper testing** — admin-only research bots that never touch a real broker.
- **Test checklist** — release regression checklist.
- `/admin/subscribers` — subscriber list and manual Stripe resync.

---

## 10. Settings and account

`/settings` — notification preferences, timezone and time format, data retention, free-tier usage, broker disconnect, chart theme and candle colours, coach voice.

---

## 11. Scheduled jobs (all under `/api/public/hooks/*`)

Each job verifies the `apikey` header before running.

| Job | What it does |
| --- | --- |
| `autopilot-tick` | Scans and files auto trades for Auto-mode accounts |
| `scan-signals` | Posts fresh A/A+ setups to the community Discord and in-app feed |
| `resolve-signals` | Resolves open signals against real price history for hit-rate stats |
| `journal-verify-tick` | Verifies unresolved journal trades every 15 minutes |
| `journal-daily-checkin` | Daily nudge to complete yesterday's trades |
| `price-alerts-tick` | Checks active price alerts |
| `send-briefings` | Morning/evening briefings by local hour |
| `weekly-review` | Weekly performance report per trader |
| `replay-refresh` | Re-runs the 2-year deterministic replay per instrument |
| `reconcile-paper` | Reconciles paper accounts |
| `paper-bot-tick` | Advances admin-only research bots |
| `drip-emails` | Advances the marketing email sequence |
| `ai-credits` | Recomputes AI budget, probes provider health, alerts admins |

Other endpoints: `/api/chat`, `/api/news-chat`, `/api/tts`, `/api/ohlc`, `/api/health`, `/api/version`, `/api/tradelocker/import`, `/api/public/stripe-webhook`, `/api/public/telegram/webhook`, `/api/public/lead-unsubscribe`, plus MCP endpoints exposing price-alert and signal tools to external clients.

---

## 12. Data and privacy

- All trader data lives in the project's own backend with row-level security; each account can only read its own rows.
- Broker credentials are encrypted at rest; the service keys are never exposed to the browser.
- Retention settings and one-click full data export are in `/settings`.
- Email unsubscribes are honoured in the provider and suppressed locally.
