import { describe, expect, it } from "vitest";
import { gradeMeets } from "@/lib/autopilot.shared";

describe("All scans minimum grade", () => {
  it("accepts a C grade", () => expect(gradeMeets("C", "ALL")).toBe(true));
  it("accepts a D grade", () => expect(gradeMeets("D", "ALL")).toBe(true));
  it("still refuses NO ENTRY", () => expect(gradeMeets("NO ENTRY", "ALL")).toBe(false));
  it("B minimum still refuses C", () => expect(gradeMeets("C", "B")).toBe(false));
});
