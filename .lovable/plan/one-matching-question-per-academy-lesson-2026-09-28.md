# One matching question per Academy lesson

## Problem
Each Academy module has 5–8 lessons (92 lessons total) but only 3 quiz questions per module. The old gate recycled the same 3 questions onto unrelated lessons; the recent fix stopped that, but now lessons 4+ have no question at all, so students click through without checking understanding.

## Fix
Author one unique question per lesson, matched to that lesson's actual content.

- Add a per-lesson question map in `src/lib/academy-quizzes.ts` keyed by lesson id (e.g. `"1.4"`), alongside the existing end-of-module quizzes.
- Each question: 4 choices, one correct answer, short plain-language explanation, written from the lesson's own teaching (candles, support/resistance, trends, risk, sessions, journaling, psychology, etc.).
- Update `src/routes/_app.academy.$moduleId.$lessonId.tsx` to look up the question by lesson id instead of by position, so every lesson shows its "Check your understanding" gate and "Answer to continue" stays enforced on all 92 lessons.
- Keep the existing 3-question end-of-module quizzes unchanged as review.

## Verification
- Typecheck passes.
- Spot-check several lessons across modules in the preview: each shows a question that matches its content, a wrong answer blocks "Next lesson", a correct answer unlocks it.
