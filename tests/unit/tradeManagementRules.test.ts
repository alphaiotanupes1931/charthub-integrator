import { describe, it, expect } from "vitest";
import {
  isAllowedExitReason,
  isVerifiedStructureClaim,
  stopInsideStructure,
} from "@/lib/trade-management-rules.shared";

describe("trade management rules v2", () => {
  it("only the five plan-card reasons can justify an exit", () => {
    expect(isAllowedExitReason("invalidation_printed")).toBe(true);
    expect(isAllowedExitReason("target_hit")).toBe(true);
    expect(isAllowedExitReason("ltf_structure_flip")).toBe(false);
    expect(isAllowedExitReason("drawdown_inside_stop")).toBe(false);
  });

  it("a 1H flip claim without a closed candle is unverified", () => {
    expect(isVerifiedStructureClaim({ level: 29427.2, timeframe: "1h" })).toBe(false);
    expect(
      isVerifiedStructureClaim({ level: 29427.2, timeframe: "1h", closedCandleTime: "14:00", closedCandleClose: 29440 }),
    ).toBe(true);
  });

  it("a 15m break never counts as a structural claim", () => {
    expect(
      isVerifiedStructureClaim({ level: 29427.2, timeframe: "15m", closedCandleTime: "14:15", closedCandleClose: 29440 }),
    ).toBe(false);
  });

  it("flags the NAS100 short stop sitting inside the 1H range high", () => {
    expect(stopInsideStructure({ long: false, stop: 29424.96, structureLevel: 29427.2 })).toBe(true);
    expect(stopInsideStructure({ long: false, stop: 29445, structureLevel: 29427.2 })).toBe(false);
  });
});
