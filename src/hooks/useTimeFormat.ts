import { useEffect, useState } from "react";

export type TimeFormat = "12h" | "24h";
const KEY = "trademind.timeFormat";

export function useTimeFormat() {
  const [format, setFormat] = useState<TimeFormat>(() => {
    if (typeof window === "undefined") return "24h";
    return ((localStorage.getItem(KEY) as TimeFormat) || "24h");
  });

  useEffect(() => {
    try { localStorage.setItem(KEY, format); } catch { /* ignore */ }
    // Broadcast so other tabs/components update live without a reload.
    window.dispatchEvent(new CustomEvent("trademind:timeformat", { detail: format }));
  }, [format]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<TimeFormat>;
      if (ce.detail && ce.detail !== format) setFormat(ce.detail);
    };
    window.addEventListener("trademind:timeformat", onChange);
    return () => window.removeEventListener("trademind:timeformat", onChange);
  }, [format]);

  return {
    format,
    setFormat,
    toggle: () => setFormat((f) => (f === "12h" ? "24h" : "12h")),
  };
}

/** Format a Date according to the user's preference. */
export function formatTime(date: Date, format: TimeFormat, opts?: { seconds?: boolean; utc?: boolean }): string {
  const hour12 = format === "12h";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: opts?.seconds ? "2-digit" : undefined,
    hour12,
    timeZone: opts?.utc ? "UTC" : undefined,
  });
}
