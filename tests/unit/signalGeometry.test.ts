import { describe, it, expect } from "vitest";
import { checkSignalGeometry } from "@/lib/signal-geometry";

describe("signal geometry guard", () => {
  it("accepts a normal BTC long and short", () => {
    expect(checkSignalGeometry({ bias: "Long", entry: 84000, stop: 83700, tp1: 84600, lastPrice: 84100 }).ok).toBe(true);
    expect(checkSignalGeometry({ bias: "Short", entry: 2690, stop: 2702, tp1: 2665, lastPrice: 2683 }).ok).toBe(true);
  });
  it("refuses a long carrying short levels (Aug 17 BTC record)", () => {
    expect(checkSignalGeometry({ bias: "Long", entry: 63498.5, stop: 63637.44, tp1: 63290.09 }).ok).toBe(false);
  });
  it("refuses BTC levels filed at gold's price (Aug 10 record)", () => {
    expect(checkSignalGeometry({ bias: "Long", entry: 4363.185, stop: 4300, tp1: 4500, lastPrice: 64000 }).ok).toBe(false);
    expect(checkSignalGeometry({ bias: "Long", entry: 4363.185, stop: -55210.73, tp1: 93724 }).ok).toBe(false);
  });
});
