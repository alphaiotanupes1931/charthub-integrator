// Local signal history. Every scan the trader runs is recorded here so the
// history list can show previous signals, whether they were taken, and how
// they turned out. Device-local (localStorage), no server cost.

export type SignalRecord = {
  id: string;
  at: number;               // epoch ms of the scan
  symbol: string;
  interval: string;         // "60", "D", ...
  grade: string;            // A+, A, B, C, NO ENTRY
  bias: string;             // Long / Short / Neutral
  entry?: number;
  stop?: number;
  tp1?: number;
  tp2?: number;
  rr?: string;
  synopsis?: string;
  source: "chart" | "engine";
  taken?: boolean;          // trader pressed "I'm taking this trade"
  takenAt?: number;
  outcome?: "win" | "loss" | "breakeven" | null;
};

const KEY = "trademind.signalHistory.v1";
const MAX = 200;
const EVT = "trademind:signal-history";

function read(): SignalRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as SignalRecord[]) : [];
  } catch {
    return [];
  }
}

function write(list: SignalRecord[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVT));
  } catch {
    /* ignore quota */
  }
}

export function listSignals(): SignalRecord[] {
  return read().sort((a, b) => b.at - a.at);
}

export function onSignalHistoryChange(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener("storage", fn);
  };
}

/** Record a scan. Repeated identical scans within 2 minutes are de-duplicated. */
export function recordSignal(input: Omit<SignalRecord, "id" | "at">): SignalRecord {
  const list = read();
  const now = Date.now();
  const dupe = list.find(
    (s) =>
      s.symbol === input.symbol &&
      s.interval === input.interval &&
      s.grade === input.grade &&
      s.bias === input.bias &&
      s.entry === input.entry &&
      now - s.at < 2 * 60 * 1000,
  );
  if (dupe) return dupe;
  const rec: SignalRecord = { ...input, id: `${now}-${Math.random().toString(36).slice(2, 8)}`, at: now };
  write([rec, ...list]);
  return rec;
}

export function markSignalTaken(id: string, taken = true) {
  write(read().map((s) => (s.id === id ? { ...s, taken, takenAt: taken ? Date.now() : undefined } : s)));
}

/** Mark the newest matching signal for a symbol as taken (used by Take-trade buttons). */
export function markLatestTaken(symbol: string): SignalRecord | null {
  const list = read();
  const idx = list.findIndex((s) => s.symbol === symbol);
  if (idx === -1) return null;
  const updated = { ...list[idx], taken: true, takenAt: Date.now() };
  const next = [...list];
  next[idx] = updated;
  write(next);
  return updated;
}

export function setSignalOutcome(id: string, outcome: SignalRecord["outcome"]) {
  write(read().map((s) => (s.id === id ? { ...s, outcome } : s)));
}

export function deleteSignal(id: string) {
  write(read().filter((s) => s.id !== id));
}

export function clearSignalHistory() {
  write([]);
}

/** Send a signal to the journal entry form and open the journal. */
export function takeTrade(rec: {
  symbol: string;
  bias: string;
  interval?: string;
  grade?: string;
  entry?: number;
  stop?: number;
  tp1?: number;
  tp2?: number;
  rr?: string;
}) {
  const tfMap: Record<string, string> = { "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1H", "240": "4H", D: "1D", W: "1W" };
  const prefill = {
    symbol: rec.symbol,
    timeframe: rec.interval ? tfMap[rec.interval] : undefined,
    side: rec.bias.toLowerCase().startsWith("s") ? "Short" : "Long",
    entry: rec.entry,
    stop: rec.stop,
    tp1: rec.tp1,
    tp2: rec.tp2,
    setup: rec.grade ? `Scan ${rec.grade}` : "Scan",
    notes: `Taken from TradeMind signal. Grade ${rec.grade ?? "-"}, ${rec.bias}${rec.rr ? `, R:R ${rec.rr}` : ""}.`,
  };
  try {
    localStorage.setItem("trademind.journal.prefill.v1", JSON.stringify(prefill));
  } catch {
    /* ignore */
  }
  markLatestTaken(rec.symbol);
  window.location.assign("/journal");
}
