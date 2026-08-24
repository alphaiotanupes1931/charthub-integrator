/** Retention windows a trader can pick for scan history (0 = keep forever). */
export const RETENTION_OPTIONS = [
  { value: 0, label: "Keep forever" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
] as const;

export const RETENTION_VALUES: readonly number[] = RETENTION_OPTIONS.map((o) => o.value);
