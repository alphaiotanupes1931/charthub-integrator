import { readLastThreadId } from "@/lib/chat-client";
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
  /** Confidence from the scan, kept so the scoreboard can band it. */
  confidence?: number | null;
  /** Active playbook at scan time, kept so the scoreboard can group by it. */
  strategyId?: string | null;
  /** Market price the plan was measured against, kept for version compares. */
  refPrice?: number | null;
  /** Feed the bars came from, kept for version compares. */
  dataSource?: string | null;
};

/** One scan of a symbol/timeframe, numbered oldest-first, with its deltas. */
export type SignalVersion = {
  record: SignalRecord;
  /** 1 = first ever scan of this symbol + timeframe. */
  version: number;
  /** Total versions recorded for this symbol + timeframe. */
  total: number;
  changes: VersionChange[];
};

export type VersionChange = {
  label: string;
  from: string;
  to: string;
  direction: "up" | "down" | "same";
};

const GRADE_RANK: Record<string, number> = {
  "A+": 6, A: 5, "A-": 4.5, "B+": 4, B: 3, C: 2, D: 1, "NO ENTRY": 0,
};

function fmtLevel(v: number | null | undefined, ref?: number | null): string {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  const basis = Math.abs(ref ?? v);
  const dec = basis >= 1000 ? 2 : basis >= 10 ? 3 : basis >= 1 ? 4 : 5;
  return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function numberChange(label: string, prev: number | null | undefined, next: number | null | undefined): VersionChange | null {
  const a = typeof prev === "number" && isFinite(prev) ? prev : null;
  const b = typeof next === "number" && isFinite(next) ? next : null;
  if (a === null && b === null) return null;
  if (a !== null && b !== null && Math.abs(a - b) < 1e-9) return null;
  return {
    label,
    from: fmtLevel(a, b),
    to: fmtLevel(b, a),
    direction: a === null || b === null ? "same" : b > a ? "up" : "down",
  };
}

/** What moved between two scans of the same instrument (older -> newer). */
export function versionChanges(older: SignalRecord, newer: SignalRecord): VersionChange[] {
  const out: VersionChange[] = [];
  if ((older.grade || "") !== (newer.grade || "")) {
    const a = GRADE_RANK[older.grade] ?? 0;
    const b = GRADE_RANK[newer.grade] ?? 0;
    out.push({ label: "Grade", from: older.grade || "—", to: newer.grade || "—", direction: b > a ? "up" : b < a ? "down" : "same" });
  }
  if ((older.bias || "") !== (newer.bias || "")) {
    out.push({ label: "Bias", from: older.bias || "—", to: newer.bias || "—", direction: "same" });
  }
  for (const [label, key] of [
    ["Entry", "entry"], ["Stop", "stop"], ["TP1", "tp1"], ["TP2", "tp2"],
  ] as const) {
    const c = numberChange(label, older[key], newer[key]);
    if (c) out.push(c);
  }
  const conf = numberChange("Confidence", older.confidence ?? null, newer.confidence ?? null);
  if (conf) out.push({ ...conf, from: `${Math.round(Number(conf.from.replace(/,/g, "")) || 0)}%`, to: `${Math.round(Number(conf.to.replace(/,/g, "")) || 0)}%` });
  const price = numberChange("Price used", older.refPrice ?? null, newer.refPrice ?? null);
  if (price) out.push(price);
  return out;
}

/**
 * Every preserved scan of one symbol + timeframe, newest first, numbered from
 * the oldest scan on record and annotated with what changed versus the scan
 * immediately before it.
 */
export function listVersions(symbol: string, interval?: string): SignalVersion[] {
  const all = read()
    .filter((s) => s.symbol === symbol && (interval ? s.interval === interval : true))
    .sort((a, b) => a.at - b.at);
  const total = all.length;
  return all
    .map((record, i) => ({
      record,
      version: i + 1,
      total,
      changes: i === 0 ? [] : versionChanges(all[i - 1], record),
    }))
    .reverse();
}

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
  // File the same scan server-side so the scoreboard can resolve it against
  // real bars later. Fire and forget: a signed-out or test session just skips.
  if (input.entry && input.stop && input.tp1 && input.grade !== "NO ENTRY") {
    void import("@/lib/signal-scores.functions")
      .then(({ recordSignalScore }) =>
        recordSignalScore({
          data: {
            symbol: input.symbol,
            timeframe: input.interval,
            grade: input.grade,
            bias: input.bias,
            confidence: input.confidence ?? null,
            strategyId: input.strategyId ?? null,
            entry: input.entry as number,
            stop: input.stop as number,
            tp1: input.tp1 as number,
          },
        }),
      )
      .catch(() => undefined);
  }
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
  /** The reason the setup was worth taking. Saved with the journal entry. */
  why?: string;
  /** What would invalidate the setup. Saved with the journal entry. */
  risk?: string;
}) {
  const tfMap: Record<string, string> = { "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1H", "240": "4H", D: "1D", W: "1W" };
  const notes = [
    `Taken from TradeMind signal. Grade ${rec.grade ?? "-"}, ${rec.bias}${rec.rr ? `, R:R ${rec.rr}` : ""}.`,
    rec.why ? `Why I took it: ${rec.why}` : "",
    rec.risk ? `Risk and invalidation: ${rec.risk}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const prefill = {
    symbol: rec.symbol,
    timeframe: rec.interval ? tfMap[rec.interval] : undefined,
    side: rec.bias.toLowerCase().startsWith("s") ? "Short" : "Long",
    entry: rec.entry,
    stop: rec.stop,
    tp1: rec.tp1,
    tp2: rec.tp2,
    setup: rec.grade ? `Scan ${rec.grade}` : "Scan",
    notes,
    // Links the journal entry back to the AI chat that produced the setup.
    threadId: readLastThreadId() ?? undefined,
  };
  try {
    localStorage.setItem("trademind.journal.prefill.v1", JSON.stringify(prefill));
  } catch {
    /* ignore */
  }
  markLatestTaken(rec.symbol);
  void import("@/lib/signal-scores.functions")
    .then(({ markSignalScoreTaken }) => markSignalScoreTaken({ data: { symbol: rec.symbol } }))
    .catch(() => undefined);
  window.location.assign("/journal");
}
