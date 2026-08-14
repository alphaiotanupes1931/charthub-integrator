// Records the setups a trader deliberately passed on, and why.
// Passing is a decision worth reviewing: "I passed 12 C-grade setups this week"
// is as useful as the trades that were taken. Stored on the device next to the
// logged-trade registry.

export type PassedTrade = {
  key: string;
  at: number;
  symbol: string;
  interval?: string;
  grade?: string;
  bias?: string;
  entry?: number | null;
  stop?: number | null;
  tp1?: number | null;
  reason: string;
  threadId?: string;
};

const KEY = "trademind.passedTrades.v1";
const EVT = "trademind:passed-trades";
const MAX = 300;

function norm(sym?: string) {
  return (sym ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function entryKey(entry?: number | null) {
  return entry == null || !Number.isFinite(entry) ? "" : String(Math.round(entry * 1e4) / 1e4);
}

export function makePassKey(input: { symbol: string; entry?: number | null; threadId?: string | null }) {
  return [input.threadId ?? "", norm(input.symbol), entryKey(input.entry)].join("|");
}

export function loadPassedTrades(): PassedTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as PassedTrade[]) : [];
  } catch {
    return [];
  }
}

function write(list: PassedTrade[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVT));
  } catch {
    /* ignore quota */
  }
}

export function recordPassedTrade(input: Omit<PassedTrade, "key" | "at"> & { at?: number }): PassedTrade {
  const mark: PassedTrade = {
    ...input,
    key: makePassKey(input),
    at: input.at && Number.isFinite(input.at) ? input.at : Date.now(),
  };
  write([mark, ...loadPassedTrades().filter((p) => p.key !== mark.key)]);
  return mark;
}

export function unpassTrade(key: string) {
  write(loadPassedTrades().filter((p) => p.key !== key));
}

/** Was this setup passed on? Falls back to symbol + entry within 7 days. */
export function findPassedTrade(input: { symbol: string; entry?: number | null; threadId?: string | null }): PassedTrade | null {
  if (typeof window === "undefined") return null;
  const list = loadPassedTrades();
  const exact = list.find((p) => p.key === makePassKey(input));
  if (exact) return exact;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const loose = list.find((p) => p.key === makePassKey({ symbol: input.symbol, entry: input.entry }) && p.at > cutoff);
  return loose ?? null;
}

export function onPassedTradesChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener("storage", fn);
  };
}
