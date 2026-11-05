import { describe, it, expect } from "vitest";
import { decodeRunner, encodeRunner, runnerLevels } from "@/lib/stop-management.shared";

describe("F9 runner levels on the broker trade", () => {
  it("NAS100 short: runner when TP2 and final pool are progressively lower", () => {
    expect(runnerLevels(false, 28600, 28404.6, 26860)).toEqual({ tp1: 28600, tp2: 28404.6, finalPool: 26860 });
  });
  it("no runner when the final pool is not beyond TP2", () => {
    expect(runnerLevels(true, 100, 110, 110)).toBeNull();
    expect(runnerLevels(true, 100, 110, null)).toBeNull();
  });
  it("round-trips through the OANDA comment and fits 128 chars", () => {
    const r = { tp1: 53806.5, tp2: 53820.6, finalPool: 54238.6 };
    const c = encodeRunner(r);
    expect(c.length).toBeLessThanOrEqual(128);
    expect(decodeRunner(c)).toEqual(r);
    expect(decodeRunner("TradeMind autopilot")).toBeNull();
  });
});
