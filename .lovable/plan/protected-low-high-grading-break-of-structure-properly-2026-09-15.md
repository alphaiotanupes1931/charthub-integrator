# Protected Low / High: Grading Break Of Structure Properly

Teach the scanner the difference between a *good* break of structure and a *bad* one, the way you described it:

- Find the break of structure (price closes beyond a prior swing).
- Walk left from the break to the **first swing low** (for an upside break) that produced the high that got broken.
- Ask one question: **did price sweep that swing low before expanding?**
  - Swept → good break, it leaves behind a **protected low**. Stop goes under the protected low, target the high. This is the setup that keeps working.
  - Not swept → bad break. Untaken liquidity is still sitting below, so a long here is the one that gets stopped out. The scanner should say so instead of grading it as a clean break.
- Mirror everything for shorts (first swing high to the right of the break's origin, protected high, stop above).

## What Changes For You

**On a scan / setup card**
- A new line under the structure read: "Good break of structure — protected low at 3402.5 (liquidity swept before expansion)" or "Bad break of structure — the swing low at 3402.5 was never swept, so liquidity is still resting below."
- Stops on a good break anchor just beyond the protected low/high rather than a generic buffer, so the stop covers the level that actually defends the trade.
- Grade effect: a setup built on an unswept break of structure can no longer be graded A. It caps at C with the plain-English reason above. A protected-low break becomes a positive factor toward A.

**In the chat / coach**
- The coach knows the rule and can explain it on any instrument: which low was swept, which was not, why the break is trustworthy, where the protected low sits.
- Asking "is this a good break of structure?" gets the structural answer, not a generic one.

**On the chart**
- The protected low/high is drawn as a labelled line, and the swept low is marked, so you can see the same thing you drew in the video.

## Technical Detail

New module `src/lib/protectedStructure.ts` (pure, testable, no network):

```ts
export type BosRead = {
  kind: "bullish" | "bearish";
  breakLevel: number;      // swing high/low that was closed through
  breakTime: number;
  originLevel: number;     // first swing low (bull) / high (bear) to the left
  originTime: number;
  swept: boolean;          // did price trade through originLevel before the break
  sweepTime: number | null;
  protectedLevel: number | null; // originLevel when swept
  quality: "protected" | "unprotected";
  reason: string;          // user-facing sentence
};
export function readProtectedStructure(candles, opts?): BosRead | null;
```

Detection uses the existing `findSwingHighs` / `findSwingLows` fractal helpers from `src/lib/agents/biasEngine.ts` so swing definitions stay consistent across the app. Sweep test: between `originTime` and the displacement leg, some candle low pierces `originLevel` (with an ATR-scaled tolerance) and price then closes back above it.

Wiring:
- `src/lib/agents/types.ts` — `MtfContext.h1` gains `bos?: BosRead | null`.
- `src/lib/agents/market-data.server.ts` — `h1Analysis` computes it from the 1H series and returns it alongside `structureBreak`.
- `src/lib/agents/planner.server.ts` —
  - new `protectedStructureRead(bias, snap)` returning `{ cap: "C", reason }` when the aligned break is unprotected; registered in `collectGradeCaps`.
  - stop placement prefers `bos.protectedLevel` (plus an ATR buffer) when the break is protected and the level sits on the correct side of entry.
  - narrative text includes the protected/unprotected sentence.
- `src/lib/agents/methodology-kb.ts` — new `structure-protected-bos` chunk so the coach cites the rule with the same wording.
- `src/lib/ai-context.ts` — the break-of-structure read is included in the chat context passed to the coach.
- Chart: emit a `chart-annotations` hline for the protected level (existing `ChartAnnotation` pipeline in `src/lib/chartAnnotations.ts`), labelled "Protected low".
- Tests: `tests/unit/protectedStructure.test.ts` — swept vs unswept upside break, mirrored downside case, no-swing fallback returns `null`, and a planner test that an unprotected break cannot grade A.
