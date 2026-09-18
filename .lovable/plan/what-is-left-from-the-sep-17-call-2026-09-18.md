# What is left from the Sep 17 call

Done so far: the Wyckoff-only mode with its written rulebook, and the verified public record with filing seals plus the inbound signal endpoint. What follows is everything still outstanding from that call, in the order it should be done.

## 1. Fix the entry-fill problem (the biggest complaint)

Marcus's "price goes straight through my entry to the stop, never in profit for 5 minutes". Three separate causes, each measured before anything changes.

**Stop entry versus limit entry.** Replay every resolved signal twice from stored bars: once assuming a limit order resting at the planned entry, once assuming a stop order triggered as price leaves the level. Report fill rate, hit rate and net R for each, split per instrument. This settles the "every pending limit should have been a pending stop" claim with numbers instead of opinion. Read-only, nothing in production changes.

**The expiry clock.** Signals are being closed as expired while still live — 60 of them went on to reach a level afterwards. Decide the hold window per instrument from the measured time-to-resolution we already store, then re-resolve the affected history and report how the win rate and average R move.

**First-bar fills.** Roughly 40% of wins hit target on their first bar with no adverse move, which usually means the entry price was already gone by the time the signal was filed. Measure how far price had travelled past the planned entry at filing time, and refuse to file a signal whose entry is already beyond a tolerance. This will reduce the number of signals and lower the recorded hit rate. That is the correct direction.

## 2. Chat that remembers corrections

Corrections made in one chat vanish in the next. The rulebook exists now but nothing writes to it. Add stored per-user principles: when the coach is corrected, it offers to save the correction, and saved principles are injected into every later chat and checked before a scan explanation is shown. Visible list, editable, deletable.

## 3. Grade calibration, only after 1 is done

Recalibrate what earns A+, A and below using the most recent third of the record held out, so the numbers are not fitted to themselves. Head and shoulders and double bottom get added as evidence that moves confidence up or down, not as separate strategies. Nothing is published as a grade change until the held-out third agrees.

## 4. Gate definitive entries while the scanner is being fixed

Marcus's fallback was to stop giving definitive entries. Rather than removing them: full entry, stop and target stays for the admin account and above a confidence threshold; below it, the scan shows the read, the levels of interest and the grade without a definitive entry. One reversible setting, so marketing can go out on the journal and education without anyone loading up on an A that fails.

## 5. Guided strategy builder

The one thing worth copying from Alpha Insider that we do not have. An interview that asks what the trader wants, then writes a versioned deterministic rulebook — no AI deciding levels — wires it to the existing backtest engine and paper bots, and shows honest limitations where the data is thin. Custom strategies currently live only in the browser, so they move to the database as part of this.

## 6. Research and reporting, not building

- The two Instagram accounts claiming ~70% win rates: check whether the claims are auditable at all before spending anything.
- Published win rates per classic setup (break and retest and similar) as a sanity check against our own numbers.
- Waitlist page for marketing while scanner confidence is low.

## Open questions

1. Do paying users see the Wyckoff mode during the test week, or admin only?
2. Gate definitive entries now, or wait until after the recalibration?
3. Which instruments does the test week cover? Gold has the most history and is what Marcus actually trades.
4. Shareable record cards were in the earlier plan — hold those until the record reads clean?

## Technical notes

- Entry-mode and expiry testing run read-only through `src/lib/signal-replay.ts`, the same path as the stop-width test, and report through a hook like the existing `signal-excursions` one.
- First-bar guard belongs in the filing path in `src/lib/signal-scores.functions.ts`, checked against the live price distance already computed for entry-trigger reads.
- Stored principles extend the `wyckoff/rulebook.ts` pattern with a per-user table, injected into `src/routes/api.chat.ts`.
- Entry gating is a display-layer flag on the planner output; the deterministic engine keeps producing full levels so the record stays complete.
- Builder reuses `src/lib/backtest/engine.ts` and `src/lib/paper-bot.server.ts`; `src/lib/customStrategies.ts` moves off localStorage.
