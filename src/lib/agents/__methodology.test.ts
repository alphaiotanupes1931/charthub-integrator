import { describe, it, expect } from "vitest";
import { selectMethodologyChunks, methodologyContextBlock, METHODOLOGY_CORE, METHOD_CHUNKS } from "@/lib/agents/methodology-kb";

describe("methodology kb", () => {
  it("retrieves wyckoff for spring questions", () => {
    const ids = selectMethodologyChunks("is this a spring and test on gold?").map(c => c.id);
    expect(ids).toContain("wyckoff-spring-test");
  });
  it("retrieves auction for value area / order flow", () => {
    const ids = selectMethodologyChunks("price left the value area, what does delta say").map(c => c.id);
    expect(ids.some(i => i.startsWith("auction"))).toBe(true);
  });
  it("boosts psychology for the psych coach", () => {
    const ids = selectMethodologyChunks("i keep moving my stop loss", "The Psychologist").map(c => c.id);
    expect(ids.some(i => i.startsWith("psy-"))).toBe(true);
  });
  it("returns nothing for unrelated chit chat", () => {
    expect(methodologyContextBlock("hey good morning")).toBeUndefined();
  });
  it("caps at 3 chunks and has no em dashes", () => {
    expect(selectMethodologyChunks("wyckoff volume value area psychology stop loss order flow spring").length).toBeLessThanOrEqual(3);
    const all = METHODOLOGY_CORE + METHOD_CHUNKS.map(c => c.body + c.title).join("");
    expect(/[\u2014\u2013]/.test(all)).toBe(false);
  });
});
