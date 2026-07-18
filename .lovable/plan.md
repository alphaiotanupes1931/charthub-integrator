# TradeMind Fix Plan — Phased Rollout

Each phase ends with a QA pass (build check + targeted browser test) before moving on. I'll pause after each phase so you can eyeball it in the preview before I move to the next.

## Phase 1 — AI Coach / Chat (highest priority)
1. Restore the long-form Replit prompts for the coach (pre-trade, mid-trade, post-trade personas) so replies feel conversational and distinct per persona.
2. Restore the "what do you think you should do?" Socratic opener before the coach answers.
3. Restore trade-management branch: if a scan is requested while an open trade exists for that symbol, respond with manage-the-trade guidance instead of a fresh entry.
4. Fix mid-sentence truncation (raise max output tokens, ensure we stream to completion, don't cap the UI text).
5. Hide system/agent scaffolding from the user (no "entry/stop are being computed by an analysis agent" leaking into chat).

**Claude API note:** I'll wire the coach path so it can call Claude once Marcus's Anthropic key is added via the secret form. I'll set up the switch and env var; the key itself needs to be pasted in by you/Marcus when Sahr sends instructions.

**QA:** send a message with each persona, run a scan, confirm no truncation, confirm no leaked system text.

## Phase 2 — Chat History
1. History rows show `INSTRUMENT BIAS — DATE TIME` (e.g. `SPX500 Long — Nov 12, 2:14pm`) instead of raw scan text.
2. Clicking a past scan re-hydrates that thread, switches the dashboard chart to the matched instrument, and re-runs the scan.
3. Add a visible **New** button pinned to the top of the history list.
4. Newest conversations sort to the top.

**QA:** create 3 scans on different symbols, reload, click each — chart should switch and rescan.

## Phase 3 — Charts
1. Fix index pricing/timezone drift on SPX500 / NAS100 / US30 (verify feed symbols + session offset).
2. Add a Sessions on/off toggle in the chart toolbar (persist per user).
3. Default the chart panel width to "default" on open (not narrow).
4. Recolor candles/markers to TradingView-style deeper hues (replace neon green / pink-red defaults; keep user overrides from the Colors popover).
5. Make sure Show-Me draws on the **live** chart, not the setup view.
6. QA sweep of majors: XAU, XAG, EURUSD, GBPUSD, USDJPY, BTC, ETH, SPX500, NAS100, US30.

**QA:** compare each symbol's last price to TradingView; toggle sessions; run Show-Me on live chart.

## Phase 4 — UX cleanup
1. Fix coach dropdown contrast (white-on-white) — force `bg-popover text-popover-foreground` and hover styles.
2. Strategy detail pages: restore educational content per strategy (Wyckoff, SMC, etc.) from the old version.
3. Simplify user-facing scan prompt copy to just "Scan SPX500" style.

**QA:** open dropdown in light + dark, open 3 strategies, run a scan and confirm clean copy.

## Phase 5 — Compliance
1. Append the "Educational only, not financial advice" disclaimer to every signal card and every scan chat reply (not just landing).
2. Verify placement on mobile.

**QA:** run scans from Analysis, Chat, and Signals tabs — disclaimer visible on all.

## Phase 6 — Show-Me finish
1. Parse "show me liquidity pools / order blocks / FVGs / session highs" etc. into level toggles.
2. Auto-clear prior drawn levels before drawing the new set.
3. Draw onto the live chart canvas (shared with Phase 3 #5).

**QA:** type 4 show-me commands in sequence, confirm previous drawings clear each time.

---

**Technical notes**
- Coach prompts live in `src/lib/agents/*` and the chat route `src/routes/api.chat.ts`. Restoring the Replit-era prompts means expanding the system prompts and persona instructions there, and raising `maxOutputTokens` on the stream.
- Claude wiring: add an `ANTHROPIC_API_KEY` secret + a provider switch in the chat route. If the key is present and coach mode = conversational, route to Claude; otherwise fall back to the current gateway model. I'll request the secret via the secure form when you're ready.
- Chat history titles: update `src/lib/chat.functions.ts` to compose `${symbol} ${bias} — ${dateTime}` from parsed scan metadata; store bias/timestamp on thread create.
- Re-scan on click: dashboard's thread-switch handler will read the thread's symbol/bias and call `runScan` after navigation.
- Index price drift: check `market-data.server.ts` symbol mapping and the session overlay offset in `NativeChart.tsx` (likely UTC vs exchange local).
- Candle recolor: update `useCandleColors.ts` defaults + the marker palette in `NativeChart.tsx`.
- Disclaimer: single `<Disclaimer />` component appended in `ChartSignalCards.tsx` and the chat scan response formatter.

Reply "go" and I'll start Phase 1. If you want a different order (e.g. Claude key first so Phase 1 tests against Claude directly), tell me and I'll re-sequence.