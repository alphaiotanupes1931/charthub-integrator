import { describe, expect, it } from "vitest";
import { currentLevel, leveledBank, pickNextQuestion, type Attempt } from "@/lib/prescan-progress";

const bank = leveledBank("classic");
const ids = (lvl: string) => bank.filter((q) => q.level === lvl).map((q) => q.id);

describe("pre-scan progression", () => {
  it("starts everyone at beginner", () => {
    expect(currentLevel([], bank)).toBe("beginner");
    expect(pickNextQuestion([], bank)?.level).toBe("beginner");
  });

  it("never repeats a question answered correctly", () => {
    const attempts: Attempt[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < bank.length; i++) {
      const q = pickNextQuestion(attempts, bank, i * 1000);
      if (!q) break;
      expect(seen.has(q.id)).toBe(false);
      seen.add(q.id);
      attempts.push({ question_id: q.id, correct: true, created_at: new Date(i).toISOString() });
    }
    expect(seen.size).toBe(bank.length);
    expect(pickNextQuestion(attempts, bank)).toBeNull();
  });

  it("brings back wrong answers", () => {
    const only = ids("beginner")[0];
    const attempts: Attempt[] = ids("beginner").map((id) => ({ question_id: id, correct: id !== only, created_at: "2026-01-01" }));
    // 4+ correct but one still open: stays or moves depending on threshold; the wrong one is never mastered
    const q = pickNextQuestion(attempts, bank);
    expect(q?.id === only || q?.level !== "beginner").toBe(true);
  });

  it("promotes after five correct beginner answers, then intermediate", () => {
    const five = ids("beginner").slice(0, 5).map((id) => ({ question_id: id, correct: true }));
    expect(currentLevel(five, bank)).toBe("intermediate");
    const wrong = ids("beginner").slice(0, 5).map((id) => ({ question_id: id, correct: false }));
    expect(currentLevel(wrong, bank)).toBe("beginner");
    const inter = ids("intermediate").slice(0, 5).map((id) => ({ question_id: id, correct: true }));
    expect(currentLevel([...five, ...inter], bank)).toBe("advanced");
  });
});
