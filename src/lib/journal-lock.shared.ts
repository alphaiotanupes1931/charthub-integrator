// Locked trade plan: the entry, stop and target a trade had the moment it was
// logged. Later edits never change it, so the journal can score both the
// original plan and whatever the trader changed it to.

export type LockedPlan = {
  entry: number;
  stop: number;
  takeProfit: number | null;
  lockedAt: number;
};

type Lockable = {
  entry?: unknown;
  stop?: unknown;
  takeProfit?: unknown;
  lockedPlan?: LockedPlan;
  createdAt?: unknown;
};

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : null;
};

/** Adds the locked plan the first time a trade has a usable entry and stop. Never overwrites one. */
export function withLockedPlan<T extends Lockable>(t: T, now = Date.now()): T {
  if (t.lockedPlan) return t;
  const entry = n(t.entry);
  const stop = n(t.stop);
  if (entry == null || stop == null || entry === 0 || stop === 0 || entry === stop) return t;
  return { ...t, lockedPlan: { entry, stop, takeProfit: n(t.takeProfit), lockedAt: n(t.createdAt) ?? now } };
}

/** True when the trader moved the entry, stop or target after logging. */
export function planEdited(t: Lockable): boolean {
  const p = t.lockedPlan;
  if (!p) return false;
  const same = (a: number | null, b: number | null) =>
    a == null || b == null ? a === b : Math.abs(a - b) <= Math.max(Math.abs(b) * 1e-6, 1e-9);
  return !(same(n(t.entry), p.entry) && same(n(t.stop), p.stop) && same(n(t.takeProfit), p.takeProfit));
}
