// Demo test schedule: one autopilot trade per New York hour, 9 AM to 5 PM,
// weekdays only (eight hourly slots: 9, 10, 11, 12, 1, 2, 3, 4).
export const DEMO_SCHEDULE_FIRST_HOUR = 9;
export const DEMO_SCHEDULE_LAST_HOUR = 16;

function nyParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, weekday };
}

/** NY hour (9-16) when this moment is inside a trading slot, else null. */
export function demoScheduleSlot(now: Date): number | null {
  const { hour, weekday } = nyParts(now);
  if (weekday === "Sat" || weekday === "Sun") return null;
  if (hour < DEMO_SCHEDULE_FIRST_HOUR || hour > DEMO_SCHEDULE_LAST_HOUR) return null;
  return hour;
}

/** Start of the current clock hour (hour boundaries are the same in NY and UTC). */
export function slotStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d;
}
