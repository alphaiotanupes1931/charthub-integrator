// Tracks which scanned setups have actually been written into the trade journal.
// "Log this trade" only prefills the journal form, so nothing is recorded here
// until the trader presses Save. The dashboard and chat read this registry so a
// setup they already logged shows "Already logged" instead of the button.

export type LoggedTradeMark = {
  key: string;
  at: number;
  tradeId: string;
  symbol: string;
  threadId?: string;
  entry?: number;
  date?: string;
};

const KEY = "trademind.loggedTrades.v1";
const EVT = "trademind:logged-trades";
const MAX = 400;

function read(): LoggedTradeMark[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as LoggedTradeMark[]) : [];
  } catch {
    return [];
  }
}

function write(list: LoggedTradeMark[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVT));
  } catch {
    /* ignore quota */
  }
}

function norm(sym?: string) {
  return (sym ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Round the entry so tiny float differences still match the same setup. */
function entryKey(entry?: number | null) {
  return entry == null || !Number.isFinite(entry) ? "" : String(Math.round(entry * 1e4) / 1e4);
}

export function makeSetupKey(input: { symbol: string; threadId?: string | null; entry?: number | null }) {
  return [input.threadId ?? "", norm(input.symbol), entryKey(input.entry)].join("|");
}

/** Record that a journal entry was really saved for this setup. */
export function markTradeLogged(input: {
  tradeId: string;
  symbol: string;
  threadId?: string | null;
  entry?: number | null;
  date?: string;
  /** When the journal entry was created; defaults to now. */
  at?: number;
}) {
  const marks: LoggedTradeMark[] = [];
  const now = input.at && Number.isFinite(input.at) ? input.at : Date.now();
  const base = { at: now, tradeId: input.tradeId, symbol: input.symbol, threadId: input.threadId ?? undefined, entry: input.entry ?? undefined, date: input.date };
  // Store both the thread-scoped key and a symbol+entry key, so the setup is
  // recognised from the chat it came from and from a fresh scan of the same level.
  marks.push({ ...base, key: makeSetupKey({ symbol: input.symbol, threadId: input.threadId, entry: input.entry }) });
  if (input.threadId) marks.push({ ...base, key: makeSetupKey({ symbol: input.symbol, entry: input.entry }) });
  const keys = new Set(marks.map((m) => m.key));
  write([...marks, ...read().filter((m) => !keys.has(m.key) && m.tradeId !== input.tradeId)]);
}

/** Drop the marks for a journal entry that was deleted. */
export function unmarkTradeLogged(tradeId: string) {
  write(read().filter((m) => m.tradeId !== tradeId));
}

/**
 * Has this setup already been logged? Matches on the chat thread first, then
 * falls back to symbol + entry within the last 7 days.
 */
export function findLoggedTrade(input: {
  symbol: string;
  threadId?: string | null;
  entry?: number | null;
}): LoggedTradeMark | null {
  if (typeof window === "undefined") return null;
  const list = read();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const exact = list.find((m) => m.key === makeSetupKey(input));
  if (exact) return exact;
  const loose = list.find(
    (m) => m.key === makeSetupKey({ symbol: input.symbol, entry: input.entry }) && m.at > cutoff,
  );
  return loose ?? null;
}

export function onLoggedTradesChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener("storage", fn);
  };
}
