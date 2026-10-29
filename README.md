# TradeMind

**Setup grading for active traders.** TradeMind scans a chart, grades the setup from A+ to No Entry, and gives a full trade plan: entry zone, stop, two targets and R:R. It also includes a trade journal, performance analytics, an AI coach, a trading academy, and optional broker connections.

> Nothing in this project is financial advice. Grades and plans are decision-support tools. Trading carries risk of loss.

## How it works

The grade is computed by **deterministic code from real price data**, not by an AI model. Direction, structure, order flow, volume and grade come from the scanner in `src/lib/`. The AI coach reads screenshots, explains the result and answers questions, and if it ever disagrees with the code, the code wins. The full breakdown is in [`docs/AI-AND-SCANNER.md`](docs/AI-AND-SCANNER.md).

## Features

- **Scanner and dashboard:** live charts, drawing tools, graded setups, grade reasons, scan history and version stamps
- **Signals and strategies:** multi-instrument signal engine, strategy library with stats, price alerts
- **Journal and analytics:** locked trade plans, performance review, trading memory, daily briefings
- **AI coach:** chat and voice coach with selectable personas
- **Academy:** lessons, quizzes, flashcards, exams and certificates
- **Brokers:** read-only connections, paper trading, live orders and an optional autopilot with a demo-only safety guard
- **Plans:** Free, Basic, Pro and Elite tiers, enforced in the UI and again on the server
- **Admin tools:** subscriber management and AI cost tracking

Every feature, with the code that powers it, is listed in [`docs/FEATURES.md`](docs/FEATURES.md).

## Tech stack

| Area | Tools |
| --- | --- |
| App | TanStack Start and Router, React 19, TypeScript, Vite |
| UI | Tailwind CSS 4, shadcn/ui (Radix), Recharts, lightweight-charts, Three.js |
| Backend | Server functions and API routes (Nitro), Supabase (Postgres, auth, row-level security), Drizzle |
| AI | Vercel AI SDK, Anthropic Claude, Gemini fallback |
| Market data and brokers | OANDA, Alpaca, Twelve Data |
| Payments and email | Stripe, transactional email |
| Testing | Vitest (unit, API, end-to-end access matrix, golden-set tests) |

## Getting started

Requires [Bun](https://bun.sh) (or Node 20+ with npm).

```bash
bun install
bun run dev
```

Create a `.env` with your Supabase project values, and set server secrets in your environment. Never commit secret keys.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Supabase project (also `VITE_`-prefixed for the client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase access |
| `ANTHROPIC_API_KEY` | Claude models |
| `AI_GATEWAY_KEY` | AI gateway key used for fallback models, speech, news, briefings and email (the legacy name `LOVABLE_API_KEY` is still read) |
| `OANDA_API_KEY`, `OANDA_ACCOUNT_ID`, `OANDA_ENV` | Market data and OANDA trading |
| `ALPACA_OAUTH_CLIENT_ID`, `ALPACA_OAUTH_CLIENT_SECRET`, `ALPACA_REDIRECT_URI` | Alpaca connection |
| `TWELVE_DATA_API_KEY` | Additional market data |
| `STRIPE_SECRET_KEY` | Billing |
| `BROKER_CREDENTIALS_ENCRYPTION_KEY` | Encrypts stored broker credentials |
| `TELEGRAM_API_KEY`, `DISCORD_WEBHOOK_URL` | Optional alert delivery |

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the dev server |
| `bun run build` | Production build |
| `bun run preview` | Preview the production build |
| `bun run lint` / `bun run format` | ESLint / Prettier |
| `bun run test` | Run all tests |
| `bun run test:api` | API route tests |
| `bun run test:matrix` | Access matrix: checks every plan can only reach what it should |

The access matrix also runs in CI on every push and pull request (`.github/workflows/access-matrix.yml`).

## Project layout

```
src/routes/        Pages and API routes (file-based routing)
src/components/    UI components
src/lib/           Scanner, detectors, AI coach, billing, brokers, autopilot
src/integrations/  Supabase client and auth
supabase/          Database migrations
drizzle/           Typed schema and queries
research/          Backtest rig and pre-registration registry
tests/             Unit, API, end-to-end and golden-set tests
docs/              Feature and AI/scanner documentation
```

## Engineering rules

[`AGENTS.md`](AGENTS.md) lists the rules the codebase follows and why, for example: entry prices come only from the named entry model, rules carry evidence tiers that decide whether they can block a trade, and the backtest rig must reuse the live detector instead of reimplementing it.

## Deployment

Built with Nitro for Vercel (`nitro.preset` in `vite.config.ts`). Database changes go through the migrations in `supabase/migrations/`.

## Platform: Lovable and Lovable Cloud

TradeMind uses [Lovable](https://lovable.dev) for its preview and test environment and [Lovable Cloud](https://docs.lovable.dev/features/cloud) for backend services. Here is how the pieces fit together:

- **Preview and testing:** changes can be previewed and tested in Lovable's preview environment before they are published.
- **Database and auth:** Postgres, authentication and row-level security run on Supabase, provisioned through Lovable Cloud. Schema changes live in `supabase/migrations/`, and the project ID is in `supabase/config.toml`.
- **Secrets:** server secrets (Supabase keys, the AI gateway key, broker and Stripe keys) are set in the project's secret settings, not committed to the repo.
- **AI gateway:** fallback models, speech, news and briefings go through Lovable's AI gateway. Server code reads its key through `getGatewayKey()` in `src/lib/gateway-key.ts`.
- **Email:** transactional and auth emails are sent through Lovable's email service. Its webhooks are handled by the routes under `src/routes/lovable/email/`.
- **Scheduled jobs:** database cron jobs (defined in the migrations) call the app's public hook routes, `src/routes/api.public.hooks.*`, for scanning, resolving signals and sending emails.
- **MCP server:** the `/mcp` routes expose a few tools (prices, signals, alerts). They are generated by `@lovable.dev/mcp-js` from the definitions in `src/lib/mcp/`.
- **GitHub sync:** the repository syncs with Lovable, so some changes arrive from Lovable and others are made directly in the repo.
