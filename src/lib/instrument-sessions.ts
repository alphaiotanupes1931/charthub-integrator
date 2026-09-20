/**
 * Per-instrument liquid sessions, in the exchange's own timezone.
 *
 * The windows used to live as fixed UTC minutes. That is correct for about four
 * months of the year and an hour out of position for the rest, because London
 * and New York both move and the gap between them changes for two weeks in
 * March and one in November. A session model that drifts by an hour is worse
 * than none: it quietly grades the New York open as the overnight session.
 *
 * So windows are declared in the timezone of the venue that actually sets the
 * price - Europe/London, America/New_York, Asia/Tokyo, Australia/Sydney - and
 * converted to that day's UTC minutes on demand. Daylight saving is then the
 * operating system's problem, which is where it belongs.
 *
 * This module is pure and has no imports from the engine, so it can be called
 * before the model is invoked rather than after.
 */

export type SessionZone = "Europe/London" | "America/New_York" | "Asia/Tokyo" | "Australia/Sydney" | "UTC";

export interface ZoneWindow {
  /** Timezone the window is quoted in. */
  tz: SessionZone;
  /** Local start, "HH:MM". */
  start: string;
  /** Local end, "HH:MM". May be earlier than start for a window crossing midnight. */
  end: string;
  label: string;
}

export interface ResolvedWindow extends ZoneWindow {
  /** Minutes from UTC midnight on the day in question. */
  startMin: number;
  endMin: number;
}

export interface SessionState {
  inside: boolean;
  /** Label of the window we are inside, or null. */
  label: string | null;
  /** Minutes until the next window opens; 0 while inside one. */
  minutesToOpen: number;
  /** Every window for this instrument, resolved for this instant. */
  windows: ResolvedWindow[];
  /** True when the venue is shut: FX and CFDs over the weekend. */
  marketClosed: boolean;
}

const HM = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const DAY = 24 * 60;

/**
 * Offset of a timezone from UTC, in minutes, at a given instant. Positive means
 * ahead of UTC. Uses the platform timezone database, so DST is always current.
 */
export function zoneOffsetMinutes(tz: SessionZone, at: Date): number {
  if (tz === "UTC") return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Convert a zone-anchored window into UTC minutes for the day of `at`. */
export function resolveWindow(w: ZoneWindow, at: Date): ResolvedWindow {
  const offset = zoneOffsetMinutes(w.tz, at);
  const norm = (m: number) => ((m % DAY) + DAY) % DAY;
  return { ...w, startMin: norm(HM(w.start) - offset), endMin: norm(HM(w.end) - offset) };
}

function insideWindow(w: ResolvedWindow, minutes: number): boolean {
  return w.startMin <= w.endMin
    ? minutes >= w.startMin && minutes <= w.endMin
    : minutes >= w.startMin || minutes <= w.endMin;
}

/**
 * Weekend closure. Spot FX, metals, indices and oil stop; crypto does not.
 * Judged in New York time, which is where the week actually rolls.
 */
export function venueClosed(tz24h: boolean, at: Date): boolean {
  if (tz24h) return false;
  const nyMinutes = at.getUTCHours() * 60 + at.getUTCMinutes() + zoneOffsetMinutes("America/New_York", at);
  const norm = ((nyMinutes % DAY) + DAY) % DAY;
  const dayShift = Math.floor(nyMinutes / DAY);
  const nyDay = (at.getUTCDay() + dayShift + 7) % 7;
  if (nyDay === 6) return true; // Saturday
  if (nyDay === 0) return norm < 17 * 60; // Sunday before the 17:00 reopen
  if (nyDay === 5) return norm >= 17 * 60; // after Friday's close
  return false;
}

export function sessionState(windows: ZoneWindow[], at: Date, opts?: { alwaysOpen?: boolean }): SessionState {
  const resolved = windows.map((w) => resolveWindow(w, at));
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  const marketClosed = venueClosed(Boolean(opts?.alwaysOpen), at);

  let label: string | null = null;
  for (const w of resolved) {
    if (insideWindow(w, minutes)) {
      label = w.label;
      break;
    }
  }
  let minutesToOpen = 0;
  if (!label) {
    minutesToOpen = Math.min(
      ...resolved.map((w) => (((w.startMin - minutes) % DAY) + DAY) % DAY),
      DAY,
    );
  }
  return { inside: Boolean(label) && !marketClosed, label: marketClosed ? null : label, minutesToOpen, windows: resolved, marketClosed };
}

// ---------------------------------------------------------------------------
// the windows themselves
// ---------------------------------------------------------------------------

export const LONDON_MORNING: ZoneWindow = { tz: "Europe/London", start: "08:00", end: "12:00", label: "London morning" };
export const LONDON_NY_OVERLAP: ZoneWindow = { tz: "America/New_York", start: "08:00", end: "12:00", label: "London/NY overlap" };
export const TOKYO: ZoneWindow = { tz: "Asia/Tokyo", start: "09:00", end: "15:00", label: "Tokyo" };
export const SYDNEY: ZoneWindow = { tz: "Australia/Sydney", start: "09:00", end: "16:00", label: "Sydney" };
export const NY_CASH_OPEN: ZoneWindow = { tz: "America/New_York", start: "09:30", end: "11:00", label: "NY cash open" };
export const NY_CLOSE: ZoneWindow = { tz: "America/New_York", start: "15:00", end: "16:00", label: "NY close" };
export const COMEX_NY: ZoneWindow = { tz: "America/New_York", start: "08:20", end: "13:00", label: "COMEX/NY" };
export const NYMEX_PIT: ZoneWindow = { tz: "America/New_York", start: "09:00", end: "14:30", label: "NYMEX pit hours" };
export const CRYPTO_US_EUROPE: ZoneWindow = { tz: "America/New_York", start: "08:00", end: "17:00", label: "Europe/US overlap" };
