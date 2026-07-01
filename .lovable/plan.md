## Goal

Turn the coach into a real 3-layer agent stack. No new sidecars, no Python — everything runs inside our existing TanStack Start server functions using the AI Gateway and our current data providers. The three layers stay decoupled so any one can be swapped later.

## The 3 Layers

```text
┌──────────────────────────────────────────────────────────────┐
│  L1 DATA  — MarketDataService (OpenBB-style unified fetch)  │
│  Twelve Data · CoinGecko · Yahoo · (news feed placeholder)  │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │  candles, quote, news, macro
                              │
┌──────────────────────────────────────────────────────────────┐
│  L2 RESEARCH  — Multi-agent analyst pool (Tauric-style)     │
│  Technical · Sentiment · Macro · Risk  ──►  ResearchMemo    │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │  ResearchMemo (JSON)
                              │
┌──────────────────────────────────────────────────────────────┐
│  L3 PLANNER  — Paperclip-style ReAct loop                   │
│  Plan → Critic → Refine (max 3 steps)  ──►  TradePlan JSON  │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │  TradePlan → ScanTicket UI + Coach chat
```

Each layer has one entry point and one JSON contract. The Coach and the Scan button both call L3, which internally calls L2, which calls L1.

## Files to add

- `src/lib/agents/types.ts` — shared TS types: `MarketSnapshot`, `AnalystNote`, `ResearchMemo`, `TradePlan`.
- `src/lib/agents/market-data.server.ts` — L1. Wraps existing `/api/ohlc` logic plus a `getSnapshot(symbol, tf)` returning `{ candles, quote, sessions, cisd, htfBias }`. Reuses `NativeChart` detection helpers extracted into `src/lib/marketAnalysis.ts`.
- `src/lib/agents/analysts/technical.ts` — prompt + zod schema, single AI call producing `AnalystNote`.
- `src/lib/agents/analysts/sentiment.ts` — same shape, uses recent-news stub (returns "no data" cleanly if none).
- `src/lib/agents/analysts/macro.ts` — DXY/yields context via existing OHLC route.
- `src/lib/agents/analysts/risk.ts` — pure code, no LLM: computes ATR-based stop distance, R multiples, session-risk flags.
- `src/lib/agents/research-orchestrator.server.ts` — L2. Runs the 4 analysts in parallel via `Promise.all`, merges into `ResearchMemo`.
- `src/lib/agents/planner-loop.server.ts` — L3. ReAct loop: `draftPlan → critique → refine`, hard-capped at 3 iterations. Emits a `TradePlan` (entry, stop, TP1/TP2, size hint, thesis, invalidation, confidence).
- `src/lib/agents/research.functions.ts` — `runResearch({ symbol, timeframe, lensId })` server function; admins uncapped, others share the existing 5/day scan cap.
- `src/routes/api/research.$symbol.ts` — thin HTTP wrapper so the Coach chat route can stream reasoning tokens back.

## Wiring into existing UI

- `ScanTicket`: when the user hits Run Scan, call `runResearch` instead of the current single-shot lens prompt. Render the `TradePlan` (already the ticket's shape) and expose a collapsible "Research" panel showing each analyst note.
- `DashboardChatPanel`: the coach gets a new tool `get_trade_plan(symbol)` that returns the latest `TradePlan` so the user can ask "why long gold?" and the coach cites analyst notes.
- No DB schema changes. Memos/plans are ephemeral per request; we can add a `research_runs` table later if the user wants history.

## What we are NOT doing this round

- No Python sidecar, no OpenBB container (kept as a future L1 swap).
- No autonomous execution / broker connection.
- No new billing tier — same admin bypass and 5/day cap.
- No new voice or chart features.

## Verification

After building: run one `runResearch({ symbol: "XAUUSD", timeframe: "15m" })` from a temp server-function call, assert the returned `TradePlan` matches the zod schema, and check the Scan button in the dashboard renders the plan without regressing the current ticket UI.

Approve and I'll build all three layers in one pass.