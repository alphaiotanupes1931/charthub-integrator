# What Feeds the AI Coach and the Scan Grades

This is the honest, complete answer to "where do the numbers come from". Two systems are documented:

1. **The AI coach** — the chat that answers your questions.
2. **The scanner** — the deterministic engine that produces the grade, entry, stop and targets.

The most important rule to understand: **the AI never decides direction or grade.** Direction, structure, order flow, volume and grade are computed in plain code from real price data. The AI only reads screenshots, writes the explanation, and answers questions. If the AI and the code disagree, the code wins and the AI's version is discarded.

Companion document: `docs/FEATURES.md` lists every feature in the app.

---

# Part 1 — The AI coach

Main file: `src/routes/api.chat.ts`

## Which models

| Purpose | Model |
| --- | --- |
| Main coach (images, deep questions, styled coaches) | Claude Sonnet 4.5 |
| Short/simple messages, grade questions | Claude Haiku 4.5 |
| Automatic fallback if Claude is unavailable or out of credit | Gemini 2.5 Flash via the AI gateway |
| Research analysts inside a scan | Gemini 3 Flash |
| News page chat | Claude Haiku 4.5, with the same fallback |

Model choice per message is made in code (`routeChatModel`), not by the AI. Before each Claude call the system runs a live health check; if Claude is failing or out of credits, traffic moves to the fallback and you see an explicit message instead of a blank reply. An account can also be pinned to a specific model by an admin.

## The prompt is built in two halves

**Half 1 — the static rulebook** (cached between messages for speed and cost):

- The coach's job description and hard rules: never invent probabilities, never claim data it does not have, never restate an old direction, quote only measured numbers.
- The core trading methodology (`src/lib/agents/methodology-kb.ts`): the top-down process, what counts as a valid order block, what confirmation means.

**Half 2 — the live context**, rebuilt on every single message. Every block below is assembled from real data, and the prompt ends with a numbered list telling the coach exactly what it was given, so it cannot pretend to know more.

| Context block | What goes in | Source |
| --- | --- | --- |
| Live clock | Current UTC date and time, so it never guesses the day or when data is due | `api.chat.ts` |
| Coach persona and voice | Which coach you picked and how it is allowed to speak | `api.chat.ts` |
| Active lens | Your chosen analysis emphasis | `src/lib/scanLens.ts` |
| Active strategy | The playbook in use, auto-selected or chosen | `src/lib/strategyAuto.ts` |
| Chart context | Current instrument, timeframe, price, ATR, 20/50 highs and lows, session, CISD state | `src/lib/agents/market-data.server.ts` |
| Timeframe ladder | Monthly, Weekly, Daily, 4H, 1H, 15m, 5m, 1m — bias, trend, structure, range per rung | `market-data.server.ts` |
| Order flow | Delta, cumulative delta and slope, point of control, value area, buy/sell imbalance, stacked imbalances, book depth, and whether the live bar disagrees with the cumulative read | `src/lib/agents/order-flow.server.ts` |
| Authoritative bias block | The deterministic Long/Short/Neutral verdict and the maximum grade allowed | `src/lib/agents/biasEngine.ts`, `bias-adapter.server.ts` |
| Your journal | Win rate, expectancy, and results broken down by symbol, direction, session, weekday and timeframe | `api.chat.ts` journal context |
| Scan track record | How this platform's own scans on this instrument have actually resolved | `src/lib/signal-evidence.server.ts` |
| Measured hit rate | Real target-vs-stop rates by grade, instrument and for you personally — only shown once there are at least 8 resolved samples | `src/lib/signal-hitrate.server.ts` |
| Long-term memory (Hermes) | Lessons saved from your past feedback and trades | `src/lib/agents/hermes.server.ts` |
| News and calendar | Upcoming high-impact events for the relevant currencies | `src/lib/news.server.ts` |
| Broker positions | Read-only balance, equity and open positions, when a broker is connected | `src/lib/broker-readonly.server.ts` |
| Methodology lookups | Extra methodology sections matched to your question's keywords | `methodology-kb.ts` |
| Level sanity check | If you type price levels, they are checked against real price first | `src/lib/levelValidation.ts` |
| Prior scans in this thread | Levels only — entry, stop, TP1, TP2, price used, timestamp | `src/lib/ai-context.ts` |

## The prior-scan rule (important)

Earlier scans in a thread are handed to the coach **with their levels but with direction and grade deliberately removed**. This exists because the coach used to read its own old "SHORT" verdicts and keep defending them after the market turned. Now every direction and grade comes fresh from the bias block computed for that turn, and the coach is told to say plainly when the market has changed against a setup you are already in.

You can see exactly what was sent using the **AI context inspector** in the chat panel.

## Delivery, saving and limits

- Replies stream token by token; internal reasoning is stripped out.
- Each message is saved to chat history before and after generation, deduplicated by message id, so refreshing never loses a conversation.
- Thread titles are set from the scanned instrument.
- Caps per account per day: 100 AI messages, 5 screenshot uploads. Admins are exempt.
- Cost per call is logged for the admin console.
- Provider failures (out of credit, rate limited) surface as plain-language errors, never a silent empty reply.

Related endpoints: `/api/news-chat` (calendar-only, no journal or chart context, not persisted) and `/api/tts` (voice; currently returns empty so the browser's own free speech synthesis is used).

---

# Part 2 — The scanner and the grade

Three layers. Layer 1 gathers facts, layer 2 interprets, layer 3 decides and is fully deterministic.

## Layer 1 — market data (`src/lib/agents/market-data.server.ts`)

Candles are fetched in a fixed provider order, identical to the order used by the chart itself so the signal and the chart you are looking at always use the same prices:

**OANDA → Binance → TwelveData → Yahoo**

- Yahoo (`src/lib/yahoo-ohlc.server.ts`) is the backstop for indices, energy and metals, which previously had no fallback at all.
- Each fetch is guarded, and a 20-minute last-good cache prevents one rate-limited provider from collapsing a scan.
- Every scan records its source, fetch time, candle count and reference price. This is the stamp shown under the plan.

From that data the platform builds a market snapshot containing:

- Price, 20/50-bar highs and lows, ATR(14), 24h change, 20-bar range.
- CISD state, level, trigger and projections.
- Active trading sessions.
- Closed 4H, 1H, 15m and 5m series plus the 4H ATR.
- **Timeframe ladder**: Monthly, Weekly, Daily, 4H, 1H, 15m, 5m, 1m — each with bias, trend, structure, last price, range and bar count. Aggregation is newest-anchored so current structure outranks a stale label.
- **Multi-timeframe cascade**: 4H sets direction, trend, key levels and supply/demand; 1H supplies structure breaks, reversals, order blocks, fair value gaps and liquidity pools; 15m supplies confirmation.
- **Order flow** (`order-flow.server.ts`): delta, cumulative delta and slope, point of control, value area, buy percentage, imbalance skew, stacked imbalances, depth (thin/normal/deep/absorbing), and a conflict flag when the live bar contradicts the cumulative read. When a feed has no volume, order flow is marked as estimated and is not allowed to support a high grade.
- **Order blocks** (`src/lib/orderBlocks.ts`): each block is scored out of 100 — freshness 38, displacement 28, higher-timeframe alignment 18, liquidity sweep 10, proximity 6 — and labelled high (75+), medium (55+) or low. Mitigation count is tracked.
- **Session volume** (`src/lib/sessionVolume.ts`): last bar volume versus the session median; below half the median counts as thin, which widens the stop floor and can turn the plan into a stand-aside window. Crypto is exempt.
- **Instrument profiles** (`src/lib/instrument-profile.server.ts`): measured ATR percentage, typical pullback depth and best session per instrument from two years of history, used to tune entry buffers, stop buffers, maximum entry distance and minimum R:R per instrument.

## The bias engine — the authoritative direction (`src/lib/agents/biasEngine.ts`)

Plain code, no AI. It produces the direction and a maximum allowed grade:

- Per-instrument configuration table with buffers, distance limits, minimum R:R and volume source.
- Two-stage 4H reversal detection (invalidated, then confirmed).
- Alignment scoring across timeframes; when the higher timeframe opposes, the grade is capped at C.
- Order flow may **confirm or degrade** a direction, never set it.
- Valid entry-zone check, stop computation and structural target picking.
- Grade caps for order-flow opposition, missing 15m confirmation and R:R below 2.

Its verdict is written into an "authoritative bias block" that goes to both the planner and the chat coach. Nothing downstream may override it.

## Layer 2 — research analysts (`research.server.ts`, `analysts.ts`)

Four analysts run in parallel:

| Analyst | Type | Weight in consensus |
| --- | --- | --- |
| Technical | AI (Gemini 3 Flash) | 3 |
| Macro | AI | 2 |
| Sentiment | AI | 1 |
| Risk | Pure code | 0 (advisory only) |

Their weighted vote becomes a research consensus and confidence. This is **input**, not the verdict — the planner can and does override it.

## Layer 3 — the planner and the grade (`src/lib/agents/planner.server.ts`)

The AI drafts a plan (with an optional critique-and-revise pass), then code overrides everything that matters.

### Direction
Resolved deterministically. When there are at least 20 four-hour candles, the bias engine's direction replaces anything the AI said. A near-term override can flip or neutralise the side when 1H, 15m and order flow all oppose the higher-timeframe direction.

### Confidence (0–100)
Counted from measurable agreement only: how many ladder rungs agree, CISD state, research consensus, order-flow direction, 4H/1H/15m confirmation, and whether price is sitting in an aligned zone. Floored at 25 when R:R is under 1.5. No unmeasured probabilities are ever produced — "70% chance" style claims are explicitly banned.

### Grade thresholds
- **A+** — confidence 84+, full timeframe alignment, and 15m agreement.
- **A** — confidence 74+, with 4H and 1H agreeing.
- **B** — confidence 58+, or 4H agreement plus an aligned zone.
- **C** — anything else that still has a valid direction.
- **NO ENTRY** — neutral direction, or a gate that forbids the trade.

### Grade caps — why you keep seeing C
Roughly a dozen independent rules run after the grade is assigned. Each can only **lower** the grade, and the lowest cap wins. Every active rule is shown to you on the dashboard with its maximum grade, a plain-language reason, and what must clear to improve it.

| Cap rule | Effect |
| --- | --- |
| Missing multi-timeframe data | C |
| Counter-trend against Daily and 4H | C, or A if the higher timeframe already broke |
| Timeframe-combination gate | NO ENTRY when 4H opposes and is unbroken; otherwise B or C by liquidity and confirmation |
| Lower-timeframe opposition | B or C |
| Order-flow opposition | C on strong real-volume opposition, otherwise B |
| Expanding delta against the position | B, or C when severe and volume is real |
| Setup type | Fade (1H against 4H) → B; 4H reversal → C, with the flip level named |
| Stale 4H data | C when the scan data predates the last 4H close |
| High-impact news within hours | Hard cap B |
| High-impact news within 48 hours | One grade lower |
| Thin session volume / poor timing | Execution wait plus a warning, rather than an automatic downgrade |
| Order block already mitigated | One grade lower |
| 1H order block below "high" quality | A and A+ drop to B |
| Bias engine maximum grade | Always clamped to it |
| Measured scoreboard performance | Fresh grade is clamped by how that grade has actually resolved |

A normal, healthy pullback into an aligned order block, FVG or supply/demand zone with 4H direction intact is treated as a **wait for the turn at B**, not a failed setup — that was the cause of the earlier all-C behaviour.

### Entry, stop and targets — structure, not R multiples
- **Entry** is anchored to real structure, ranked: high-quality 1H order blocks → fair value gaps → 4H supply/demand → key levels → liquidity. A genuine pullback gap of roughly 0.4 to 2.2 ATR is required, so the plan does not chase price. Price-adjacent anchors are ignored.
- **Stop** sits beyond the far edge of the zone, widened by the swing beyond it and by a session-aware minimum ATR floor.
- **TP1** is the nearest opposing structural level that pays for the risk; **TP2** is the next distinct level. Clustered levels are collapsed, and each target is checked for ATR reachability on the scan timeframe. A measured-move multiple is used only when no structure exists at all. **R:R is reported, not used to place targets.**
- **Triggers and waits** — a plan is only live once its confirmation rule fires: 5m displacement for scalps, 15m confirmation for intraday, a 1H break for swings. Until then you get a watch level and the exact confirmation rule.
- **Sniper refinement** (deterministic) looks for a deeper fib/OTE anchor on a finer timeframe and only accepts it if R:R improves meaningfully.

### Trade style and playbook
Auto-selected from live conditions — trend, alignment, ATR percentage, range, depth and market class — and shown with the reason. You can override it.

## Audit trail and honesty controls

- Every plan carries a **methodology version** (`src/lib/scanner-methodology.ts`) so any scan can be reproduced.
- Every plan is stored in the signal scoreboard, then resolved bar by bar against real price history. A bar that touches both stop and target counts as a **stop** — deliberately conservative. Each timeframe has an expiry window.
- Resolved outcomes feed the published hit rates, which are split before and after the engine fix date (`src/lib/signal-engine-version.ts`) so old and new engine results are never mixed into one number.
- Hit rates only appear once there are at least 8 resolved samples.
- A two-year replay of the deterministic engine across all instruments runs in the admin console, labelled `validated`, `needs-calibration` or `insufficient-data` (minimum 30 trades and positive expectancy to validate). Replay results are research, not published performance.

## Module map

**Layer 1 — data:** `market-data.server.ts`, `yahoo-ohlc.server.ts`, `api.ohlc.ts`, `order-flow.server.ts`, `orderBlocks.ts`, `sessionVolume.ts`, `quote.server.ts`, `instrument-profile.server.ts`, `oanda-host.server.ts`

**Bias:** `biasEngine.ts`, `bias-adapter.server.ts`

**Layer 2 — research:** `analysts.ts`, `research.server.ts`, `methodology-kb.ts`

**Layer 3 — planning:** `planner.server.ts`, `sniper.server.ts`, `strategy-auto.server.ts`, `strategyAuto.ts`, `scanner-methodology.ts`, `types.ts`

**Scoring and feedback:** `signal-scores.server.ts`, `signal-hitrate.server.ts`, `signal-evidence.server.ts`, `signal-engine-version.ts`, `engine-replay.functions.ts`, `trade-verify.server.ts`

**Chat:** `api.chat.ts`, `ai-context.ts`, `ai-gateway.server.ts`, `ai-routing.ts`, `anthropic-health.server.ts`, `ai-cost.server.ts`, `hermes.server.ts`, `news.server.ts`, `levelValidation.ts`, `broker-readonly.server.ts`

**Entry points:** `research.functions.ts` (single scan), `signal-engine.functions.ts` (watchlist scan)
