import { describe, it, expect } from "vitest";
import { highImpactAhead, normalizeImpact, type CalendarEvent } from "@/lib/news.server";

const ev = (over: Partial<CalendarEvent>): CalendarEvent => ({
  title: "CPI y/y",
  country: "USD",
  date: "2026-09-15T12:30:00.000Z",
  impact: "High",
  forecast: "",
  previous: "",
  ...over,
});

describe("economic calendar", () => {
  it("normalizes feed impact labels", () => {
    expect(normalizeImpact("High Impact Expected")).toBe("High");
    expect(normalizeImpact("Medium Impact Expected")).toBe("Medium");
    expect(normalizeImpact("Non-Economic")).toBe("Low");
    expect(normalizeImpact("Holiday")).toBe("Holiday");
  });

  it("keeps timed high-impact releases inside the window", () => {
    const ref = new Date("2026-09-15T11:00:00.000Z");
    expect(highImpactAhead([ev({})], 4, ref)).toHaveLength(1);
  });

  it("excludes all-day and tentative rows from timed windows", () => {
    const ref = new Date("2026-09-15T11:00:00.000Z");
    const rows = [ev({ title: "Fed Chair Speaks", allDay: true, date: "2026-09-15T12:00:00.000Z" })];
    expect(highImpactAhead(rows, 4, ref)).toHaveLength(0);
  });

  it("ignores releases that already happened", () => {
    const ref = new Date("2026-09-15T13:00:00.000Z");
    expect(highImpactAhead([ev({})], 4, ref)).toHaveLength(0);
  });
});
