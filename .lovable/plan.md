# TradeMind — Replicate the App

Build the authenticated app shell from the screenshots: persistent left sidebar + top search bar + main content area, styled in the existing warm-black + gold theme. Wire up all 8 pages with the same layout, content, and empty-states shown in the references.

## Layout (shared shell)

A new `_app` layout route renders on every authenticated page:

- **Left sidebar (260px)**: TradeMind logo + wordmark, nav items (Dashboard, Guide, Trade Journal, Strategies, AI Coaches, Voice Coach, Analytics, Trading Memory, System Status, Settings, Coach Dashboard, Admin), "AI Coach / Active: The Analyst" card, Telegram alerts card, user email + Sign Out.
- **Top bar**: sidebar-collapse button + "Search ⌘K" pill.
- **Footer line**: "This is educational analysis only, not financial advice…"
- Active nav item gets gold border + tint (matches screenshots).

## Pages

```
/dashboard          Live chart + right rail (Performance, Ready to scan, Order Flow, Chat/Analysis tabs)
/journal            Trade Journal — Calendar / Trades / Sessions tabs; calendar grid for current month
/strategies         Strategy Library — search + filters + grid of strategy cards (seed 9 strategies)
/coaches            AI Coach Library — Generic (active) banner + grid of 3 personality cards
/voice-coach        Voice Coach — Active Coach selector, mic button, Quick prompts
/analytics          Analytics — "No data yet" empty state + "Ask AI About Your Performance"
/memory             Trading Memory — Log Session, AI corrections, Recommendations, Pattern + Lessons
/mentor             Coach Dashboard — Invite a trader + empty roster
/guide              Guide page (simple how-it-works content, placeholder OK)
```

`/` redirects to `/dashboard`. Settings/System Status/Admin nav items render simple placeholder pages.

## Key components

- `<AppShell>` (sidebar + topbar + outlet) used by all routes via `_app.tsx` layout.
- `<TradingViewChart>` (already exists) on dashboard.
- `<StrategyCard>`, `<CoachCard>`, `<CalendarGrid>`, `<EmptyState>` reusable.
- Seed data lives in `src/data/strategies.ts` and `src/data/coaches.ts` (static; matches screenshots).

## Out of scope (frontend-only replica)

No real auth, no real journal persistence, no real AI calls, no real broker data. This is the **visual + navigational replica** of the app. We can wire any of those up next as separate steps once the shell looks right.

## Technical details

- TanStack Start file-based routes; create `src/routes/_app.tsx` (layout w/ `<Outlet />`) + one file per page above.
- Reuse existing gold/warm-black tokens in `src/styles.css`; add sidebar/topbar tokens if needed.
- Fonts: Fraunces (display) for page H1s like "Trade Journal", "Analytics", "My Trading Memory"; Inter for everything else — already loaded.
- Icons via `lucide-react` (already installed).
