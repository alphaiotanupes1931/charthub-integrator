import { describe, it, expect } from "vitest";
import { readASetup, applyASetup, type ASetupRead } from "@/lib/a-setup-sequence.shared";

const done: ASetupRead = { step: "retest", stepsDone: 4, complete: true, fvgTop: 1, fvgBot: 0, retestTime: 1, text: "" };
const partial: ASetupRead = { ...done, step: "fvg", stepsDone: 3, complete: false };

describe("A-setup grade rule", () => {
  it("complete sequence lifts B to A", () => expect(applyASetup("B", done, false).grade).toBe("A"));
  it("complete sequence never lifts past A", () => expect(applyASetup("A", done, false).grade).toBe("A"));
  it("does not lift when another cap binds", () => expect(applyASetup("B", done, true).grade).toBe("B"));
  it("A without the full sequence drops to B", () => expect(applyASetup("A", partial, false).grade).toBe("B"));
  it("never blocks: C stays C", () => expect(applyASetup("C", partial, false).grade).toBe("C"));
  it("neutral bias has no sequence", () => expect(readASetup("Neutral", []).complete).toBe(false));
});
