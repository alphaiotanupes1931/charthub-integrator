import { useEffect, useState } from "react";

const KEY = "trademind.timezone";
const EVENT = "trademind:timezone";

/** Special sentinel meaning "use the browser's local timezone". */
export const AUTO_TZ = "auto";

export type TimezoneOption = { value: string; label: string };

/** Curated list of trading-relevant timezones. IANA names. */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: AUTO_TZ,             label: "Auto (device local)" },
  { value: "UTC",               label: "UTC" },
  { value: "America/New_York",  label: "New York (ET)" },
  { value: "America/Chicago",   label: "Chicago (CT)" },
  { value: "America/Denver",    label: "Denver (MT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "Europe/London",     label: "London (GMT/BST)" },
  { value: "Europe/Frankfurt",  label: "Frankfurt (CET)" },
  { value: "Asia/Dubai",        label: "Dubai (GST)" },
  { value: "Asia/Tokyo",        label: "Tokyo (JST)" },
  { value: "Asia/Hong_Kong",    label: "Hong Kong (HKT)" },
  { value: "Asia/Singapore",    label: "Singapore (SGT)" },
  { value: "Australia/Sydney",  label: "Sydney (AEST/AEDT)" },
];

function readInitial(): string {
  if (typeof window === "undefined") return AUTO_TZ;
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v;
  } catch { /* ignore */ }
  return AUTO_TZ;
}

export function useTimezone() {
  const [tz, setTzState] = useState<string>(readInitial);

  useEffect(() => {
    try { localStorage.setItem(KEY, tz); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: tz }));
  }, [tz]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail && ce.detail !== tz) setTzState(ce.detail);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [tz]);

  const resolved = tz === AUTO_TZ ? undefined : tz;
  return { timezone: tz, resolvedTimezone: resolved, setTimezone: setTzState };
}

/** Format a timestamp in the given timezone. Falls back to browser local when tz is undefined. */
export function formatInTimezone(
  date: Date,
  tz: string | undefined,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  return date.toLocaleString(undefined, { timeZone: tz, ...opts });
}
