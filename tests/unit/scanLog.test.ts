import { describe, it, expect } from "vitest";
import { normalizeScanLevels } from "@/lib/scan-log.shared";

describe("scan log levels", () => {
  it("clears entry, stop and target on a Neutral scan", () => {
    const r = normalizeScanLevels({ bias: "Neutral", grade: "C", entry: 4200, stop: 4180, tp1: 4240 });
    expect(r).toMatchObject({ entry: null, stop: null, tp1: null, status: "no_trade" });
  });
  it("clears levels on NO ENTRY even with a direction", () => {
    expect(normalizeScanLevels({ bias: "Long", grade: "NO ENTRY", entry: 1, stop: 0.9, tp1: 1.2 }).status).toBe("no_trade");
  });
  it("keeps levels on a directional graded scan", () => {
    const r = normalizeScanLevels({ bias: "short", grade: "B", entry: 4182.14, stop: 4222.47, tp1: 4133.26 });
    expect(r).toMatchObject({ bias: "Short", entry: 4182.14, status: "open" });
  });
});
