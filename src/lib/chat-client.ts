// Stable per-browser id used to scope chat threads/messages without auth.
const KEY = "trademind.clientId.v1";

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

const JOURNAL_KEY = "trademind.journal.trades.v1";
export function readJournal(): unknown[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const COACH_KEY = "trademind.activeCoach";
export function readActiveCoach(): string {
  if (typeof window === "undefined") return "The Analyst";
  return window.localStorage.getItem(COACH_KEY) || "The Analyst";
}

export function writeActiveCoach(name: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(COACH_KEY, name); } catch { /* ignore */ }
}

export const STRATEGY_KEY = "trademind.activeStrategy";
export function readActiveStrategy(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(STRATEGY_KEY); } catch { return null; }
}

const LAST_CHART_KEY = "trademind.lastChart.v1";
export type LastChart = { ticker: string; intervalLabel: string; enabledLevels?: string };
export function readLastChart(): LastChart | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_CHART_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p.ticker === "string" && typeof p.intervalLabel === "string") return p as LastChart;
  } catch { /* ignore */ }
  return null;
}
export function writeLastChart(c: LastChart) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LAST_CHART_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

const LAST_THREAD_KEY = "trademind.lastThread.v1";
export function readLastThreadId(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(LAST_THREAD_KEY); } catch { return null; }
}
export function writeLastThreadId(id: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LAST_THREAD_KEY, id); } catch { /* ignore */ }
}
export function clearLastThreadId(id?: string) {
  if (typeof window === "undefined") return;
  try {
    if (!id || window.localStorage.getItem(LAST_THREAD_KEY) === id) {
      window.localStorage.removeItem(LAST_THREAD_KEY);
    }
  } catch { /* ignore */ }
}
