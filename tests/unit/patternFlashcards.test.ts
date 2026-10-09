import { describe, expect, it } from "vitest";
import { PATTERN_CARDS, nameChoices, nextCard, recordAnswer } from "@/lib/pattern-flashcards";

describe("pre-scan pattern flashcards", () => {
  it("never repeats a card until every card has been shown", () => {
    let seen: string[] = [];
    const shown = new Set<string>();
    for (let i = 0; i < PATTERN_CARDS.length; i++) {
      const c = nextCard(seen, [], i * 7);
      expect(shown.has(c.id)).toBe(false);
      shown.add(c.id);
      seen = recordAnswer(seen, [], c.id, true).seen;
    }
    expect(shown.size).toBe(PATTERN_CARDS.length);
  });
  it("brings a missed card back, but not twice in a row", () => {
    const r = recordAnswer([], [], "hammer", false);
    expect(nextCard(["doji"], r.missed, 0).id).toBe("hammer");
    expect(nextCard(r.seen, r.missed, 0).id).not.toBe("hammer");
  });
  it("head and shoulders is bearish, double bottom is bullish", () => {
    expect(PATTERN_CARDS.find((c) => c.id === "hs")!.bias).toBe("bearish");
    expect(PATTERN_CARDS.find((c) => c.id === "double_bottom")!.bias).toBe("bullish");
  });
  it("offers four unique choices including the answer", () => {
    for (const c of PATTERN_CARDS) {
      const ch = nameChoices(c, 3);
      expect(ch).toContain(c.name);
      expect(new Set(ch).size).toBe(4);
    }
  });
});
