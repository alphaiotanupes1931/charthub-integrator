# Plan from the Sep 17 call with Marcus

## First, on Claude

Claude is already the model behind the coach chat. Verified in the code: the chat sends to Claude Sonnet 4.5 (with Haiku for the lighter calls like the news desk and health checks), and only falls back to a second model if the Claude key is unavailable or unhealthy. The model badge in the chat header shows which one answered. So there is nothing to switch on for the coach.

Two things it does not mean, and both are worth being clear about:

- The tool used to build this website is Claude Code. That is already the case and does not change.
- Switching models will not fix the scanner. The entries, stops, targets and grades are produced by our own deterministic rules; Claude only explains them. A better model narrates the same numbers more fluently.

## What the call actually asks for

Marcus's decision at the end of the call, in his words: do not strip the scanner yet, give it another week, but strip it down to its core and feed it one thing it can practise perfectly — Wyckoff. Marketing goes out as a waitlist meanwhile.

Under that sit four separate complaints, and they need separating because they have different fixes:

1. A grades are not outperforming; B grades feel better. Confirmed as a measurement problem so far, not yet proven as a grading problem — the current record has A at 103 decided trades and A+ at 2, which is too thin to conclude from.
2. Price goes straight through the entry to the stop. "Not in profit for 5 minutes." This is an entry-fill and timing issue, not direction.
3. Every pending limit should have been a pending stop. That is a specific, testable rule change.
4. Chat has no fixed principles, so it improvises differently each session, and corrections in one chat do not carry to the next.

## Proposed order of work

### 1. A clean Wyckoff-only engine, as a separate mode (the core of the ask)
A second scanning mode that ignores every strategy preset and knows only Wyckoff market structure: accumulation, distribution, markup, markdown, plus the protected break-of-structure logic we already built. Four to five rules, written down, visible in the app, and nothing else feeding it. It runs alongside today's scanner rather than replacing it, so paying users are not disturbed and we can compare the two on the same instruments over the same period.

### 2. A written rulebook the AI must check against
Sahr's point in the call. One stored set of principles that every scan and every chat reply is validated against before it is shown, instead of the model deciding in the moment. This also answers Marcus's question about memory: what he corrects in a chat does not persist today, and a rulebook is where corrections belong.

### 3. Fix the entry-fill problem
Two measurable pieces:
- Test stop-entry versus limit-entry across the resolved history and report which fills better per instrument. This settles complaint 3 with numbers.
- The expiry clock closes setups while they are still live — 60 of them went on to reach a level afterwards. And roughly 40% of wins hit target on the first bar with no adverse move, which suggests the entry price was already gone when the signal was filed. Both change what the win rate means.

### 4. Grade calibration, only after 3
Recalibrate what earns A+, A, A-minus and below on the Wyckoff engine, using the held-out most recent third of the record so the numbers are not fitted to themselves. Chart patterns Marcus named (head and shoulders, double bottom) get added as evidence that raises or lowers confidence, not as separate strategies.

### 5. Presentation while the scanner is being fixed
Marcus's fallback was to stop giving definitive entries and let people reach the conclusion themselves. Rather than removing it, gate it: full entry/stop/target stays for the admin account and for anyone above a confidence threshold; below that, the scan shows the read, the levels of interest and the grade without a definitive entry. One setting, reversible in a day, so marketing can launch on the journal and education without anyone loading up on an A that fails.

## Research items from the call

- Alpha Insider — go through it and report what it does that we do not, before paying for anything.
- The two Instagram accounts claiming ~70% win rates — verify the claims are checkable before spending.
- Published win rates per classic strategy (break and retest at ~58%, etc.) to sanity-check our own numbers against.

I would treat these as reading and reporting, not implementation, until one of them survives scrutiny.

## Open questions for Marcus

1. Wyckoff-only as a new mode next to today's scanner, or replace today's scanner outright? The plan above assumes alongside.
2. Do paying users see the Wyckoff mode during the test week, or admin only?
3. Hide definitive entries below a confidence threshold now, or wait for the recalibration?
4. Which instruments does the test week cover? Gold alone has the most history and is what he actually trades.

## Honest note on the 60-70% target

A 60%+ win rate is reachable on a narrow definition — one instrument, one session, one setup, with a stop wide enough to survive the wick. It is not reachable across every instrument and timeframe at once, and the competitors quoting 70% are almost always quoting the narrow version. The Wyckoff-only mode is the right shape for that: narrow it deliberately, prove it there, then widen.

## Technical detail

- Chat model routing already lives in `src/lib/ai-routing.ts` with health probing in `src/lib/anthropic-health.server.ts`; Claude Sonnet 4.5 is primary, Haiku for light calls. No change needed.
- Wyckoff mode reuses `src/lib/protectedStructure.ts` and the existing bar-clock closed-candle rules; it gets its own scoring path so it can be compared against the current planner output without touching published grades.
- The rulebook is a stored, versioned document injected into both the scan prompt and the coach system prompt, with a validation pass before display.
- Stop-versus-limit entry testing runs read-only over stored signals through the existing replay path (`src/lib/signal-replay.ts`), same as the stop-width test, so no production behaviour changes while we measure.
- Grade recalibration uses the held-out most recent third of resolved signals; no learned weights until clean resolved outcomes exist in sufficient number.
