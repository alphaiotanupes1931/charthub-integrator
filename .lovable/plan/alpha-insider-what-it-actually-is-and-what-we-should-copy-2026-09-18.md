# Alpha Insider: what it actually is, and what we should copy

## What I found

Alpha Insider is not a signal scanner and not a competitor to our analysis engine. It is a **strategy marketplace plus an execution layer**.

- Public marketplace of stock and crypto strategies ranked by performance, drawdown and risk. Claims 15,000+ users, 5,000+ live strategies, $10M+ broker-connected assets.
- **Tamper-proof forward testing.** Every published strategy is paper traded live on their platform. Creators cannot delete, edit or backdate a trade. This is the core of their credibility claim.
- **Conservative fill modelling.** They deliberately apply pessimistic fee and slippage estimates so a copied trade should fill at least as well on the real broker as the published record shows.
- **Auto-trading.** Connect a broker (Alpaca, Binance, Hyperliquid, Lighter) and the platform mirrors strategy trades into your account. Paid tiers allow splitting capital across several strategies.
- **Signals in from anywhere.** A documented REST + WebSocket API and webhooks accept trades from TradingView, n8n, Zapier, Make, or your own code.
- **The "Strategy Creator skill" from the video is not a product feature.** It is a public MIT-licensed prompt pack on GitHub (`AlphaInsider/skills`) — three markdown skill files that instruct a coding assistant to interview the user, write a persistent `plan.md`, build an offline backtest script, then create a strategy on Alpha Insider through the API and schedule it. There is no proprietary backtest engine and no repainting-proof magic. The claims in the video are structurally accurate but the substance is: a question script, a plan file, a bring-your-own backtest, and their order API. Their own skill text warns that historical price data has gaps and that approximations must not be presented as faithful results.

## What matters for us

Their genuine advantages over what we have today are not analytical. They are trust mechanics and distribution:

1. **Immutable published record.** We already file every scan and resolve it against real bars — this is the same idea, and arguably stronger. What we lack is the presentation: an append-only, publicly checkable record that a stranger can audit.
2. **Cost-adjusted reporting by default.** They quote conservative net numbers. We only just added estimated costs, and it is still labelled gross-first in places.
3. **Interview-driven strategy definition.** Their questioning script is the whole "no code strategy builder". We already have a deterministic engine, a rulebook pattern (`src/lib/wyckoff/rulebook.ts`), paper bots and a backtest engine — we have the hard parts and are missing the guided front door.
4. **Signal-in webhooks.** They let outside tools push trades in. We push out to Discord and OANDA, but have no documented inbound webhook.

Their weakness is exactly our strength: they have no market-structure engine, no grading, no journaling and no coaching. We should not become a marketplace.

## Recommended sequence

I do not recommend integrating with Alpha Insider. Everything worth having can be built with our own code, and pointing our execution at a third party would hand them the trust asset we are trying to build.

### Stage 1 — Verified track record (this is the one that pays)
Turn the scoreboard into a published, auditable record.

- Freeze filed signals as append-only: a stored hash of instrument, direction, entry, stop, targets, grade and filing timestamp. Any later edit is visible as a mismatch.
- A public, read-only record page: every resolved signal, entry, stop, target, outcome, gross R, net R, MAE, MFE, duration — with the sample count attached to every figure, as already agreed.
- Net-first presentation. Gross shown beside it, with an explicit note that costs are estimated from a static per-instrument spread table, not historical spreads.
- No headline claim until the outstanding data-quality items are closed (expiry clock, first-bar fills).

### Stage 2 — Guided strategy builder (their "skill", as a native feature)
- A short interview flow — market, session, structure trigger, entry type, stop rule, target rule, cadence, risk — that produces a **versioned rulebook object**, exactly like the Wyckoff rulebook, not free text.
- Run each rulebook through the existing backtest engine, then attach it to a paper bot for forward testing.
- Publish nothing until the forward record exists. Backtests are labelled in-sample everywhere.

### Stage 3 — Inbound and outbound signal API
- An authenticated inbound webhook so TradingView, n8n or a user's own script can file a signal that our resolver then scores on the same terms as ours.
- Keep OANDA as the execution path. No third-party mirroring.

### Stage 4 — Distribution mechanics (only after Stage 1 reads well)
- Shareable strategy/record cards with locked history.
- Marketing waits on the record, per the earlier decision.

## Technical notes

- Reuse rather than rebuild: `src/lib/backtest/engine.ts`, `src/lib/signal-replay.ts`, `src/lib/signal-excursions.server.ts`, `src/lib/paper-bot.server.ts`, `src/lib/wyckoff/rulebook.ts`.
- `src/lib/customStrategies.ts` currently stores custom strategies in browser local storage only. The builder needs them in the database, versioned, with a stable id the paper bot and scoreboard can both reference.
- Immutability: a `filed_hash` column plus a verification pass that recomputes and reports mismatches. Do not overwrite stored verdicts automatically, matching the existing excursion-backfill behaviour.
- Public record page under a normal route; the inbound webhook under `src/routes/api/public/` with signature verification.
- No Alpha Insider dependency, no API key, no vendor code. Their skill files are MIT, but they only describe their own API — nothing to reuse.

## Open decisions

- Is the public record fully open, or gated behind the waitlist?
- Does the guided builder ship to users, or stay internal until grade separation is fixed?
- Do we accept inbound third-party signals at all, given they will sit next to ours on the same record?
