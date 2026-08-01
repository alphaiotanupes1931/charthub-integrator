import { describe, it, expect } from "vitest";
import { fetchCalendar, todaysEvents, highImpactAhead, formatCalendarLines, currenciesFor } from "@/lib/news.server";
describe("calendar", () => {
  it("fetches and formats", async () => {
    const all = await fetchCalendar();
    expect(all.length).toBeGreaterThan(0);
    const ahead = highImpactAhead(all, 24 * 7);
    console.log("today:", todaysEvents(all).length, "ahead:", ahead.length);
    console.log(formatCalendarLines(ahead, "UTC", 4).join("\n"));
    expect(currenciesFor("XAU/USD")).toContain("USD");
    expect(currenciesFor("EUR/USD").sort()).toEqual(["EUR","USD"]);
  }, 30000);
});
