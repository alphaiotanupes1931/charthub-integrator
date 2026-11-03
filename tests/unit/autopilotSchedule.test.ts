import { describe, it, expect } from "vitest";
import { demoScheduleSlot } from "@/lib/autopilot-schedule.shared";

describe("demo hourly schedule", () => {
  it("trades at 9 AM New York on a weekday", () => {
    expect(demoScheduleSlot(new Date("2026-11-03T14:05:00Z"))).toBe(9);
  });
  it("last slot is the 4 PM hour", () => {
    expect(demoScheduleSlot(new Date("2026-11-03T21:30:00Z"))).toBe(16);
  });
  it("no trade at 5 PM New York", () => {
    expect(demoScheduleSlot(new Date("2026-11-03T22:00:00Z"))).toBeNull();
  });
  it("no trade before 9 AM", () => {
    expect(demoScheduleSlot(new Date("2026-11-03T13:59:00Z"))).toBeNull();
  });
  it("no trade on weekends", () => {
    expect(demoScheduleSlot(new Date("2026-11-07T15:00:00Z"))).toBeNull();
  });
});
