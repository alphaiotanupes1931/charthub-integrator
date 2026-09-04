import { InfoTip } from "@/components/InfoTip";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  Calendar as CalIcon,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
  TrendingUp,
  TrendingDown,
  ImageIcon,
  Upload,
  Download,
  AlertTriangle,
  BarChart3,
  Sparkles,
  Brain,
  Save as SaveIcon,
  Filter as FilterIcon,
  Bookmark,
  DatabaseBackup,
  HeartPulse,
  MessageSquare,
  RefreshCw,
  Ban,
} from "lucide-react";
import { LevelWarnings } from "@/components/LevelWarnings";
import { validateLevels } from "@/lib/levelValidation";
import { MentalStatePanel, upsertMentalEntry, SCORE_META, loadMental, type MentalEntry } from "@/components/MentalStatePanel";
import JournalReviewPanel from "@/components/JournalReviewPanel";

import { exportMyData } from "@/lib/privacy.functions";
import { verifyJournalTrade } from "@/lib/trade-verify.functions";
import { toast } from "sonner";
import { pullAndMerge, pushAll, type SyncTrade } from "@/lib/journal-sync";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";
import { markTradeLogged, unmarkTradeLogged } from "@/lib/loggedTrades";
import { loadPassedTrades, onPassedTradesChange, unpassTrade, type PassedTrade } from "@/lib/passedTrades";

import {
  getTradeImage,
  getTradeImages,
  putTradeImages,
  deleteTradeImages,
  compressImageFile,
} from "@/lib/journalImages";
import { ImportClosedTradesPanel } from "@/components/ImportClosedTradesPanel";
import type { ParsedClosedTrade } from "@/lib/journal-import.functions";
import { parseTradeSetupScreenshot, parseTradeSetupText } from "@/lib/journal-import.functions";

import { ActionLoader } from "@/components/ActionLoader";

export const Route = createFileRoute("/_app/journal")({
  head: () => ({ meta: [{ title: "Trade Journal, TradeMind" }] }),
  component: JournalPage,
});

const MONTH_NAMES = [
  "JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
  "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER",
];

const TIMEFRAMES = ["1m","5m","15m","30m","1H","4H","1D","1W"] as const;
type Timeframe = typeof TIMEFRAMES[number];

type Side = "Long" | "Short";

const LOSS_CATEGORIES = [
  "FOMO / chasing",
  "Revenge trade",
  "No stop / moved stop",
  "Oversized position",
  "Against trend",
  "News / volatility",
  "Bad entry timing",
  "Held too long",
  "Cut winner too early",
  "Overtrading",
  "Other",
] as const;
type LossCategory = typeof LOSS_CATEGORIES[number];

type Trade = {
  id: string;
  date: string;       // local YYYY-MM-DD, never UTC-shifted
  timeframe: Timeframe;
  symbol: string;
  side: Side;
  entry: number;
  exit: number;
  stop: number;
  takeProfit?: number;   // planned TP level
  size: number;
  fees?: number;          // total commissions + swap for the trade
  pointValue?: number;    // $ per 1.0 price move per unit (contract multiplier / pip value)
  notes: string;
  hasImage?: boolean;
  /** How many screenshots are stored for this trade (1 = legacy single image). */
  imageCount?: number;
  /** Did the trader actually pull the trigger on this setup? */
  executed?: boolean;
  executedAt?: number;
  ruleBroken?: boolean;
  ruleBrokenNote?: string;
  lossCategory?: LossCategory;
  setup?: string;         // free-text pattern tag e.g. "UTAD", "Breakout"
  // Trade review checklist — helps weekly reviews and AI coaching.
  followedPlan?: boolean;
  gradeMatch?: "yes" | "no" | "partial";
  takeaway?: string;
  /** Outcome of the trade: checked against live price history or set by hand. */
  result?: TradeResult;
  /** Where the result came from, so a manual call is never overwritten. */
  resultSource?: "auto" | "manual";
  /** Realised R at the moment the result was decided. */
  resultR?: number | null;
  /** Plain-language explanation shown under the badge. */
  resultNote?: string;
  resultCheckedAt?: number;
  /** AI chat thread that produced this setup, so the trade links back to it. */
  threadId?: string;
  /** Coaching conversation attached from the dashboard chat ("To journal"). */
  chatLog?: string;
  chatLogSavedAt?: number;
  createdAt: number;
};

export type TradeResult = "tp" | "stop" | "breakeven" | "partial" | "open";

const RESULT_META: Record<TradeResult, { label: string; cls: string }> = {
  tp: { label: "Take profit hit", cls: "bg-bull/15 text-bull border-bull/30" },
  breakeven: { label: "Breakeven", cls: "bg-bull/10 text-bull border-bull/25" },
  stop: { label: "Stop loss hit", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  partial: { label: "Closed part way", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  open: { label: "Still open", cls: "bg-muted/40 text-muted-foreground border-border/60" },
};

const MANUAL_RESULTS: { value: TradeResult | ""; label: string }[] = [
  { value: "", label: "Not set" },
  { value: "tp", label: "Take profit hit" },
  { value: "breakeven", label: "Breakeven" },
  { value: "partial", label: "Closed part way" },
  { value: "stop", label: "Stop loss hit" },
  { value: "open", label: "Still open" },
];


const STORAGE_KEY = "trademind.journal.trades.v1";
const MENTAL_KEY = "trademind.mental.v1";
const VIEWS_KEY = "trademind.journal.views.v1";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayYmd = () => ymd(new Date());
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function formatYmdHuman(s: string): string {
  const d = parseYmd(s);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// Accurate P&L: gross move x direction x size x point value, minus fees.
// point value defaults to 1 (matches raw price units for spot / crypto).
function tradePnl(t: Trade): number {
  const dir = t.side === "Long" ? 1 : -1;
  const size = t.size || 0;
  const pv = t.pointValue && isFinite(t.pointValue) && t.pointValue > 0 ? t.pointValue : 1;
  const fees = t.fees && isFinite(t.fees) ? t.fees : 0;
  return (t.exit - t.entry) * dir * size * pv - fees;
}
function tradeRR(t: Trade): number | null {
  const risk = Math.abs(t.entry - t.stop);
  if (!risk || !isFinite(risk)) return null;
  const dir = t.side === "Long" ? 1 : -1;
  const reward = (t.exit - t.entry) * dir;
  return reward / risk;
}
function plannedRR(t: Trade): number | null {
  if (t.takeProfit == null || !isFinite(t.takeProfit)) return null;
  const risk = Math.abs(t.entry - t.stop);
  if (!risk) return null;
  const dir = t.side === "Long" ? 1 : -1;
  return ((t.takeProfit - t.entry) * dir) / risk;
}


function loadTrades(): Trade[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveTrades(trades: Trade[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("trademind:trades-updated"));
  } catch { /* ignore */ }
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportTradesCsv(trades: Trade[]) {
  const headers = ["date","timeframe","symbol","side","entry","exit","stop","takeProfit","size","pointValue","fees","pnl","rr","plannedRR","ruleBroken","ruleBrokenNote","lossCategory","setup","followedPlan","gradeMatch","takeaway","result","resultR","executed","notes"];
  const rows = trades.map((t) => {
    const rr = tradeRR(t);
    const prr = plannedRR(t);
    return [
      t.date, t.timeframe, t.symbol, t.side,
      t.entry, t.exit, t.stop, t.takeProfit ?? "", t.size,
      t.pointValue ?? "", t.fees ?? "",
      tradePnl(t).toFixed(2),
      rr == null ? "" : rr.toFixed(3),
      prr == null ? "" : prr.toFixed(3),
      t.ruleBroken ? "yes" : "",
      t.ruleBrokenNote ?? "",
      t.lossCategory ?? "",
      t.setup ?? "",
      t.followedPlan ? "yes" : t.followedPlan === false ? "no" : "",
      t.gradeMatch ?? "",
      t.takeaway ?? "",
      t.result ?? "",
      t.resultR ?? "",
      t.executed === undefined ? "" : t.executed ? "yes" : "no",
      t.notes ?? "",
    ].map(csvEscape).join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trademind-journal-${todayYmd()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Full backup: local trades + mental state + everything the server holds for this user
// (profile, chats, hermes memory, alerts, notifications, invites, connections, subscriptions).
async function exportBackupJson(trades: Trade[]) {
  let mental: unknown = [];
  try {
    const raw = localStorage.getItem(MENTAL_KEY);
    if (raw) mental = JSON.parse(raw);
  } catch { /* ignore */ }

  // Compute wins/losses summary from local trades for a quick human-readable header.
  const pnls = trades.map((t) => tradePnl(t)).filter((n) => Number.isFinite(n));
  const wins = pnls.filter((n) => n > 0).length;
  const losses = pnls.filter((n) => n < 0).length;
  const breakeven = pnls.filter((n) => n === 0).length;
  const netPnl = pnls.reduce((s, n) => s + n, 0);

  let serverData: unknown = null;
  let serverError: string | null = null;
  try {
    serverData = await exportMyData();
  } catch (e) {
    serverError = (e as Error).message ?? "Could not reach server for account data.";
  }

  const payload = {
    kind: "trademind.backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    summary: { total: trades.length, wins, losses, breakeven, netPnl },
    trades,
    mental,
    account: serverData,
    accountError: serverError,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trademind-backup-${todayYmd()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importBackupJson(file: File, currentTrades: Trade[]): Promise<Trade[]> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== "object") throw new Error("Invalid backup file");
  const incomingTrades = Array.isArray(data.trades) ? (data.trades as Trade[]) : [];
  // Merge by id, incoming wins.
  const byId = new Map<string, Trade>();
  for (const t of currentTrades) byId.set(t.id, t);
  for (const t of incomingTrades) if (t && t.id) byId.set(t.id, t);
  const merged = Array.from(byId.values());
  if (Array.isArray(data.mental)) {
    try {
      const raw = localStorage.getItem(MENTAL_KEY);
      const existing = raw ? JSON.parse(raw) : [];
      const mBy = new Map<string, unknown>();
      if (Array.isArray(existing)) for (const e of existing) if (e && typeof e === "object" && "date" in e) mBy.set(String((e as { date: string }).date), e);
      for (const e of data.mental) if (e && typeof e === "object" && "date" in e) mBy.set(String((e as { date: string }).date), e);
      localStorage.setItem(MENTAL_KEY, JSON.stringify(Array.from(mBy.values())));
    } catch { /* ignore */ }
  }
  return merged;
}

// Saved insights views
export type InsightsFilter = {
  from?: string;
  to?: string;
  symbols?: string[];
  side?: "all" | "Long" | "Short";
  setup?: string;
  ruleBroken?: "all" | "yes" | "no";
};
type SavedView = { id: string; name: string; filter: InsightsFilter };
function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveViews(v: SavedView[]) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}
function applyFilter(trades: Trade[], f: InsightsFilter): Trade[] {
  return trades.filter((t) => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.symbols && f.symbols.length && !f.symbols.includes(t.symbol)) return false;
    if (f.side && f.side !== "all" && t.side !== f.side) return false;
    if (f.setup && f.setup.trim() && !(t.setup ?? "").toLowerCase().includes(f.setup.trim().toLowerCase())) return false;
    if (f.ruleBroken === "yes" && !t.ruleBroken) return false;
    if (f.ruleBroken === "no" && t.ruleBroken) return false;
    return true;
  });
}


function JournalPage() {
  const [tab, setTab] = useState<"calendar" | "trades" | "review" | "insights" | "mental">("calendar");
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [synced, setSynced] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<string>(todayYmd());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dayView, setDayView] = useState<string | null>(null);

  // Load once, and only write back on renders that happen after the load.
  // Saving during the first commit would persist the empty initial state and
  // erase a log that is already on disk.
  useEffect(() => {
    // Rebuild the "already logged" registry from the journal itself, so trades
    // saved before this device knew about it are still recognised in the chat.
    const backfill = (list: Trade[]) => {
      for (const t of list) {
        markTradeLogged({ tradeId: t.id, symbol: t.symbol, threadId: t.threadId ?? null, entry: t.entry, date: t.date, at: t.createdAt });
      }
    };
    const local = loadTrades();
    setTrades(local);
    backfill(local);
    setHydrated(true);
    // Then reconcile with the account copy so a fresh login / new device sees
    // the same journal instead of an empty calendar.
    void pullAndMerge(local as unknown as SyncTrade[])
      .then((merged) => {
        setTrades(merged as unknown as Trade[]);
        backfill(merged as unknown as Trade[]);
        // Only start mirroring upwards once we know what the account already
        // holds, otherwise this device's list would overwrite the cloud copy.
        setSynced(true);
      })
      .catch(() => undefined);

  }, []);
  useEffect(() => {
    if (!hydrated) return;
    saveTrades(trades);
    if (!synced) return;
    const timer = setTimeout(() => { void pushAll(trades as unknown as SyncTrade[]).catch(() => undefined); }, 400);
    return () => clearTimeout(timer);
  }, [hydrated, synced, trades]);


  // ---- Automatic outcome checking -------------------------------------------
  // The server sweeps every unresolved trade on a 15-minute cron and writes the
  // outcome (plus an inbox notification). While the journal is open we also
  // check locally on the same cadence so the row flips without a refresh, and
  // announce anything that just resolved.
  const checkingRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return;

    const sweep = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      try {
        const list = loadTrades();
        const pending = list.filter(
          (t) =>
            t.resultSource !== "manual" &&
            (!t.result || t.result === "open") &&
            !!t.symbol &&
            isFinite(t.entry) &&
            isFinite(t.stop) &&
            t.entry !== t.stop &&
            Date.now() - (t.resultCheckedAt ?? 0) > 2 * 60_000,
        );
        const updates = new Map<string, Trade>();
        for (const t of pending.slice(0, 12)) {
          try {
            const res = await verifyJournalTrade({
              data: {
                symbol: t.symbol,
                timeframe: t.timeframe,
                side: t.side,
                entry: t.entry,
                stop: t.stop,
                takeProfit: t.takeProfit ?? null,
                since: t.createdAt || parseYmd(t.date).getTime(),
              },
            });
            // Write the resolved price into `exit` so P&L and R:R stop showing 0.
            const resolved = res.status === "tp" || res.status === "stop" || res.status === "breakeven" || res.status === "partial";
            const manualExit = t.exit != null && Number.isFinite(t.exit) && t.exit !== 0 && t.exit !== t.entry && t.resultSource === "manual";
            const exit = resolved && res.price != null && Number.isFinite(res.price) && !manualExit ? res.price : t.exit;
            updates.set(t.id, {
              ...t,
              exit,
              result: res.status,
              resultSource: "auto",
              resultR: res.r,
              resultNote: res.note,
              resultCheckedAt: Date.now(),
            });

            if (res.status !== "open") {
              const label = RESULT_META[res.status].label;
              const rTxt = res.r == null ? "" : ` ${res.r > 0 ? "+" : ""}${res.r}R`;
              toast(`${t.symbol} ${t.side} — ${label}${rTxt}`, { description: res.note });
              try {
                if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                  new Notification(`${t.symbol} ${t.side} — ${label}${rTxt}`, { body: res.note });
                }
              } catch { /* browser notifications are best effort */ }
            }
          } catch { /* keep sweeping the rest */ }
        }
        if (updates.size) {
          setTrades((prev) => prev.map((t) => updates.get(t.id) ?? t));
        }
        // Pick up anything the server cron resolved while we were away.
        const merged = await pullAndMerge(loadTrades() as unknown as SyncTrade[]).catch(() => null);
        if (merged) setTrades(merged as unknown as Trade[]);
      } finally {
        checkingRef.current = false;
      }
    };

    void sweep();
    // Refresh outcomes every 3 minutes while the journal is open, plus whenever
    // the tab or window regains focus, so opening the page always re-checks.
    const id = window.setInterval(() => { void sweep(); }, 3 * 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void sweep(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);





  type Prefill = { symbol?: string; timeframe?: string; notes?: string; entry?: number; stop?: number; tp1?: number; tp2?: number; side?: Side; setup?: string };
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("trademind.journal.prefill.v1");
      if (!raw) return;
      const data = JSON.parse(raw) as Prefill;
      localStorage.removeItem("trademind.journal.prefill.v1");
      setPrefill(data);
      setFormDate(todayYmd());
      setEditingId(null);
      setFormOpen(true);
    } catch { /* ignore */ }
  }, []);


  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = useMemo(() => {
    const map = new Map<string, { count: number; pnl: number }>();
    for (const t of trades) {
      const cur = map.get(t.date) ?? { count: 0, pnl: 0 };
      cur.count += 1;
      cur.pnl += tradePnl(t);
      map.set(t.date, cur);
    }
    return map;
  }, [trades]);

  const sortedTrades = useMemo(
    () => [...trades].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)),
    [trades],
  );

  const wins = useMemo(() => sortedTrades.filter((t) => tradePnl(t) > 0), [sortedTrades]);
  const losses = useMemo(() => sortedTrades.filter((t) => tradePnl(t) < 0), [sortedTrades]);

  const openNew = (date: string) => { setEditingId(null); setFormDate(date); setFormOpen(true); };
  const openEdit = (t: Trade) => { setEditingId(t.id); setFormDate(t.date); setFormOpen(true); };

  const handleSave = (t: Trade) => {
    setTrades((prev) => {
      const exists = prev.some((p) => p.id === t.id);
      return exists ? prev.map((p) => (p.id === t.id ? t : p)) : [t, ...prev];
    });
    setFormOpen(false);
    setEditingId(null);
    // Only a real save counts as "logged", so the chat and dashboard can tell
    // the trader they already submitted this setup.
    markTradeLogged({
      tradeId: t.id,
      symbol: t.symbol,
      threadId: t.threadId ?? null,
      entry: t.entry,
      date: t.date,
    });
    emitFirstWeekEvent("journal-log");
  };
  // Screenshot import: turn parsed rows into real journal trades.
  const handleScreenshotImport = (parsed: ParsedClosedTrade[], shots: Blob[]) => {
    const created: Trade[] = [];
    for (const p of parsed) {
      const entry = Number.isFinite(p.entry ?? NaN) ? (p.entry as number) : 0;
      const exit = Number.isFinite(p.exit ?? NaN) ? (p.exit as number) : entry;
      const stop = Number.isFinite(p.stop ?? NaN) ? (p.stop as number) : 0;
      const size = Number.isFinite(p.size ?? NaN) && (p.size as number) > 0 ? (p.size as number) : 1;
      const fees = Number.isFinite(p.fees ?? NaN) ? Math.abs(p.fees as number) : 0;
      const dir = p.side === "Long" ? 1 : -1;
      const move = (exit - entry) * dir * size;
      // Trust the P&L printed on the screenshot: back out the contract
      // multiplier so the journal's own maths lands on the same number.
      let pointValue: number | undefined;
      if (p.pnl !== null && Number.isFinite(p.pnl) && move !== 0) {
        const pv = (p.pnl + fees) / move;
        if (Number.isFinite(pv) && pv > 0) pointValue = Math.round(pv * 1e6) / 1e6;
      }
      const netPnl = p.pnl ?? move * (pointValue ?? 1) - fees;
      const tf = (TIMEFRAMES as readonly string[]).includes(p.timeframe ?? "")
        ? (p.timeframe as Timeframe)
        : "15m";
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      created.push({
        id,
        date: p.date ?? todayYmd(),
        timeframe: tf,
        symbol: p.symbol,
        side: p.side,
        entry,
        exit,
        stop,
        takeProfit: Number.isFinite(p.takeProfit ?? NaN) ? (p.takeProfit as number) : undefined,
        size,
        fees,
        pointValue,
        notes: [p.notes, "Imported from a closed-session screenshot."].filter(Boolean).join(" "),
        executed: true,
        executedAt: Date.now(),
        result: netPnl > 0 ? "tp" : netPnl < 0 ? "stop" : "breakeven",
        resultSource: "manual",
        resultNote: "Read from the closed-trades screenshot.",
        resultCheckedAt: Date.now(),
        hasImage: shots.length > 0,
        imageCount: shots.length || undefined,
        createdAt: Date.now(),
      });
    }
    if (!created.length) return;
    // A broker screenshot usually closes out trades the trader already logged
    // from a scan. Match those instead of creating a duplicate: same symbol and
    // side, entry within a tolerance, and not resolved yet.
    setTrades((prev) => {
      const rest = [...prev];
      const fresh: Trade[] = [];
      const closedIds: string[] = [];
      for (const c of created) {
        const tol = Math.max(Math.abs(c.entry) * 0.002, 1e-6);
        const idx = rest.findIndex(
          (t) =>
            t.symbol.toUpperCase() === c.symbol.toUpperCase() &&
            t.side === c.side &&
            (!t.result || t.result === "open") &&
            Math.abs((t.entry || 0) - c.entry) <= tol,
        );
        if (idx >= 0) {
          const existing = rest[idx]!;
          rest[idx] = {
            ...existing,
            exit: c.exit,
            size: c.size,
            fees: c.fees,
            pointValue: c.pointValue ?? existing.pointValue,
            takeProfit: existing.takeProfit ?? c.takeProfit,
            executed: true,
            executedAt: existing.executedAt ?? c.executedAt,
            result: c.result,
            resultSource: "manual",
            resultNote: "Closed out from a broker screenshot.",
            resultCheckedAt: Date.now(),
            notes: [existing.notes, "P&L read from a broker screenshot."].filter(Boolean).join(" ").slice(0, 2000),
            hasImage: existing.hasImage || shots.length > 0,
            imageCount: (existing.imageCount ?? 0) + (shots.length || 0) || undefined,
          };
          closedIds.push(existing.id);
        } else {
          fresh.push(c);
        }
      }
      for (const id of closedIds) if (shots.length) void putTradeImages(id, shots);
      for (const t of fresh) {
        if (shots.length) void putTradeImages(t.id, shots);
        markTradeLogged({ tradeId: t.id, symbol: t.symbol, entry: t.entry, date: t.date });
      }
      return [...fresh, ...rest];
    });
    emitFirstWeekEvent("journal-log");
  };


  const handleDelete = (id: string) => {
    setTrades((prev) => prev.filter((p) => p.id !== id));
    unmarkTradeLogged(id);
    void deleteTradeImages(id);
  };

  const editing = editingId ? trades.find((t) => t.id === editingId) ?? null : null;

  const TABS = [
    { id: "calendar" as const, label: "Calendar", icon: CalIcon },
    { id: "trades" as const, label: "Trades", icon: BookOpen },
    { id: "review" as const, label: "Wins vs Losses", icon: BarChart3 },
    { id: "insights" as const, label: "Insights", icon: Brain },
    { id: "mental" as const, label: "Mental State", icon: HeartPulse },
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Trade Journal"
        description={
          <>
            Log every trade with entry, stop, take-profit and exit. Flag rule breaks and tag losing
            trades by cause. The journal computes R:R and P&amp;L, splits wins from losses, and
            surfaces patterns from your history.
          </>
        }
      />

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm transition ${
                  active
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => openNew(todayYmd())}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Log trade
        </button>
      </div>

      {tab === "calendar" && (
        <div className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-center justify-between px-2 sm:px-4 py-2 mb-2">
            <button
              onClick={() => setCursor(new Date(year, month - 1, 1))}
              className="h-8 w-8 rounded-xl hover:bg-accent flex items-center justify-center"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="font-display text-base sm:text-lg tracking-wider">
              {MONTH_NAMES[month]} {year}
            </div>
            <button
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              className="h-8 w-8 rounded-xl hover:bg-accent flex items-center justify-center"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-[10px] sm:text-xs text-muted-foreground font-mono border-b border-border/60">
            {["S","M","T","W","T","F","S"].map((d, i) => (
              <div key={i} className="text-center py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              if (d == null) {
                return <div key={i} className="aspect-[5/4] border-b border-r border-border/40" />;
              }
              const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`;
              const day = byDay.get(dateStr);
              const isToday = dateStr === todayYmd();
              const positive = day && day.pnl > 0;
              const negative = day && day.pnl < 0;
              return (
                <button
                  key={i}
                  onClick={() => (day ? setDayView(dateStr) : openNew(dateStr))}
                  className={`group relative aspect-[5/4] border-b border-r border-border/40 p-1.5 sm:p-2 text-left transition hover:bg-accent/40 ${
                    isToday ? "bg-primary/5" : ""
                  }`}
                  title={day ? `View trades on ${formatYmdHuman(dateStr)}` : `Add trade on ${formatYmdHuman(dateStr)}`}
                >
                  <div className={`text-xs sm:text-sm ${isToday ? "text-primary font-semibold" : "text-foreground/80"}`}>
                    {d}
                  </div>
                  {day && (
                    <div className="mt-1 space-y-0.5">
                      <div className={`text-[10px] sm:text-xs font-semibold ${positive ? "text-bull" : negative ? "text-destructive" : "text-muted-foreground"}`}>
                        {day.pnl >= 0 ? "+" : ""}{day.pnl.toFixed(2)}
                      </div>
                      <div className="text-[9px] sm:text-[10px] text-muted-foreground">
                        {day.count} {day.count === 1 ? "trade" : "trades"}
                      </div>
                    </div>
                  )}
                  <Plus className="absolute right-1 top-1 h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground transition" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "trades" && <ImportClosedTradesPanel onImport={handleScreenshotImport} />}

      {tab === "trades" && <PassedSetupsPanel />}

      {tab === "trades" && (
        <TradesList
          trades={sortedTrades}
          onEdit={openEdit}
          onDelete={handleDelete}
          onImport={(merged) => setTrades(merged)}
          onUpdate={handleSave}
        />

      )}

      {tab === "review" && (
        <WinsLossesReview wins={wins} losses={losses} onEdit={openEdit} />
      )}

      {tab === "insights" && (
        <div className="space-y-4">
          <JournalReviewPanel
            trades={sortedTrades.map((t) => ({
              date: t.date,
              symbol: t.symbol,
              side: t.side,
              pnl: tradePnl(t),
              rr: tradeRR(t) ?? undefined,
              notes: t.notes || undefined,
              followedPlan: t.ruleBroken === undefined ? undefined : !t.ruleBroken,
            }))}
            mental={loadMental().map((m) => ({ date: m.date, score: m.score, mood: m.mood }))}
          />
          <InsightsPanel trades={sortedTrades} />
        </div>
      )}

      {tab === "mental" && (
        <MentalStatePanel />
      )}

      {dayView && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-background/80 backdrop-blur-sm"
          onClick={() => setDayView(null)}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[90vh] overflow-auto rounded-t-2xl sm:rounded-2xl border border-border/60 bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border/60">
              <div>
                <div className="text-[10px] tracking-tight text-muted-foreground">Trades logged</div>
                <div className="text-lg font-semibold">{formatYmdHuman(dayView)}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { const d = dayView; setDayView(null); openNew(d); }}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
                >
                  <Plus className="h-4 w-4" /> Log trade
                </button>
                <button
                  onClick={() => setDayView(null)}
                  className="h-9 w-9 rounded-xl hover:bg-accent flex items-center justify-center"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="divide-y divide-border/60">
              {sortedTrades.filter((t) => t.date === dayView).map((t) => (
                <TradeRow
                  key={t.id}
                  t={t}
                  onEdit={(tr) => { setDayView(null); openEdit(tr); }}
                  onDelete={handleDelete}
                  onUpdate={handleSave}
                />
              ))}
            </div>
          </div>
        </div>
      )}


      {formOpen && (
        <TradeFormModal
          initialDate={formDate}
          editing={editing}
          prefill={editing ? null : prefill}
          onClose={() => { setFormOpen(false); setEditingId(null); setPrefill(null); }}
          onSave={(t) => { handleSave(t); setPrefill(null); }}
        />
      )}
    </div>
  );
}

function TradesList({
  trades, onEdit, onDelete, onImport, onUpdate,
}: {
  trades: Trade[];
  onEdit: (t: Trade) => void;
  onDelete: (id: string) => void;
  onImport: (merged: Trade[]) => void;
  onUpdate: (t: Trade) => void;
}) {
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const handleRestore = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const merged = await importBackupJson(file, trades);
      onImport(merged);
      alert(`Backup restored. ${merged.length} trades in journal.`);
    } catch (e) {
      alert(`Restore failed: ${(e as Error).message}`);
    }
  };
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border/60 bg-card/60">
        <div className="text-xs text-muted-foreground">
          {trades.length} {trades.length === 1 ? "trade" : "trades"}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => exportTradesCsv(trades)}
            disabled={trades.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-accent/40 transition disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            onClick={() => exportBackupJson(trades)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-accent/40 transition"
          >
            <DatabaseBackup className="h-3.5 w-3.5" /> Backup (JSON)
          </button>
          <button
            onClick={() => restoreInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-accent/40 transition"
          >
            <Upload className="h-3.5 w-3.5" /> Restore
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => { void handleRestore(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
      </div>
      {trades.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No trades logged yet. Hit <span className="text-foreground font-medium">Log trade</span> to add one, or restore a JSON backup above.
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {trades.map((t) => (
            <TradeRow key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}


function ResultBadge({ t }: { t: Trade }) {
  if (!t.result) return null;
  const meta = RESULT_META[t.result];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${meta.cls}`}
      title={t.resultNote ?? undefined}
    >
      {meta.label}
      {t.resultR != null && <span className="opacity-70">{t.resultR > 0 ? "+" : ""}{t.resultR}R</span>}
      {t.resultSource === "manual" && <span className="opacity-60">manual</span>}
    </span>
  );
}

/** Checks the trade against real price bars and stores the outcome. */
function CheckResultButton({ t, onUpdate }: { t: Trade; onUpdate: (t: Trade) => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await verifyJournalTrade({
        data: {
          symbol: t.symbol,
          timeframe: t.timeframe,
          side: t.side,
          entry: t.entry,
          stop: t.stop,
          takeProfit: t.takeProfit ?? null,
          since: t.createdAt || parseYmd(t.date).getTime(),
        },
      });
      // The verifier reads real bars and returns the price the trade resolved
      // at. Without writing it back to `exit`, the row keeps showing +0.00 and
      // R:R 0.00 even though the stop or target actually printed.
      const resolved = res.status === "tp" || res.status === "stop" || res.status === "breakeven" || res.status === "partial";
      const manualExit = t.exit != null && Number.isFinite(t.exit) && t.exit !== 0 && t.exit !== t.entry && t.resultSource === "manual";
      const exit = resolved && res.price != null && Number.isFinite(res.price) && !manualExit ? res.price : t.exit;
      onUpdate({
        ...t,
        exit,
        result: res.status,
        resultSource: "auto",
        resultR: res.r,
        resultNote: res.note,
        resultCheckedAt: Date.now(),
      });
    } catch (e) {
      onUpdate({ ...t, resultNote: `Could not check: ${(e as Error).message}`, resultCheckedAt: Date.now() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={run}
      disabled={busy}
      className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-border/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40 disabled:opacity-50"
      title="Check this trade against live price history"
    >
      {busy ? (
        <ActionLoader label="Checking real bars" size="sm" inline />
      ) : (
        <>
          <RefreshCw className="h-3 w-3" /> Check result
        </>
      )}
    </button>
  );
}

/**
 * Asks straight out whether the trader actually pulled the trigger on a logged
 * setup. Once answered it shows the answer and stays editable.
 */
function ExecutedToggle({ t, onUpdate }: { t: Trade; onUpdate: (t: Trade) => void }) {
  const set = (executed: boolean) => onUpdate({ ...t, executed, executedAt: Date.now() });
  if (t.executed === undefined) {
    return (
      <div className="shrink-0 flex items-center gap-1" title="Did you actually place this trade?">
        <span className="hidden sm:inline text-[10px] text-muted-foreground">Executed?</span>
        <button
          onClick={() => set(true)}
          className="rounded-xl border border-border/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-bull hover:border-bull/40 hover:bg-bull/10"
        >
          Yes
        </button>
        <button
          onClick={() => set(false)}
          className="rounded-xl border border-border/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/10"
        >
          No
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => set(!t.executed)}
      title={`${t.executed ? "Marked as executed" : "Marked as not executed"} — tap to change`}
      className={`shrink-0 rounded-xl border px-2 py-1 text-[10px] font-semibold ${
        t.executed
          ? "border-bull/30 bg-bull/10 text-bull"
          : "border-border/60 bg-muted/30 text-muted-foreground"
      }`}
    >
      {t.executed ? "Executed" : "Not executed"}
    </button>
  );
}

/** Setups the trader consciously skipped, with the reason they typed. */
function PassedSetupsPanel() {
  const [list, setList] = useState<PassedTrade[]>([]);
  useEffect(() => {
    const sync = () => setList(loadPassedTrades());
    sync();
    return onPassedTradesChange(sync);
  }, []);
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <Ban className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold">Setups you passed</div>
        <div className="text-[11px] text-muted-foreground ml-auto">{list.length} logged</div>
      </div>
      <div className="divide-y divide-border/60">
        {list.slice(0, 15).map((p) => (
          <div key={p.key} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-semibold">{p.symbol}</span>
                {p.grade && <span className="text-[10px] rounded bg-muted/40 px-1.5 py-0.5 text-muted-foreground">Grade {p.grade}</span>}
                {p.interval && <span className="text-[10px] rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground">{p.interval}</span>}
                <span className="text-xs text-muted-foreground">{new Date(p.at).toLocaleString()}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                {p.reason || "No reason given"}
                {p.entry != null ? ` · entry ${p.entry}` : ""}
              </div>
            </div>
            <button
              onClick={() => unpassTrade(p.key)}
              className="shrink-0 h-8 w-8 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
              aria-label="Remove passed setup"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeRow({ t, onEdit, onDelete, onUpdate }: { t: Trade; onEdit: (t: Trade) => void; onDelete: (id: string) => void; onUpdate: (t: Trade) => void }) {
  const pnl = tradePnl(t);
  const rr = tradeRR(t);

  return (
    <div className="flex items-center gap-4 p-4 hover:bg-accent/20 transition">
      {t.hasImage && <TradeThumb tradeId={t.id} />}
      <button onClick={() => onEdit(t)} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{t.symbol}</span>
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
            t.side === "Long" ? "bg-bull/15 text-bull" : "bg-destructive/15 text-destructive"
          }`}>
            {t.side === "Long" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {t.side}
          </span>
          <span className="text-[11px] tracking-tight text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">
            {t.timeframe}
          </span>
          <span className="text-xs text-muted-foreground">{formatYmdHuman(t.date)}</span>
          {t.setup && (
            <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5">{t.setup}</span>
          )}
          {t.ruleBroken && (
            <span className="inline-flex items-center gap-1 text-[10px] rounded bg-amber-500/15 text-amber-500 px-1.5 py-0.5">
              <AlertTriangle className="h-3 w-3" /> rule break
            </span>
          )}
          {t.lossCategory && (
            <span className="text-[10px] rounded bg-destructive/10 text-destructive px-1.5 py-0.5">{t.lossCategory}</span>
          )}
          <ResultBadge t={t} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
          <span>Entry <span className="text-foreground font-medium">{t.entry}</span></span>
          <span>Stop <span className="text-foreground font-medium">{t.stop || "-"}</span></span>
          {t.takeProfit != null && t.takeProfit !== 0 && <span>TP <span className="text-foreground font-medium">{t.takeProfit}</span></span>}
          <span>Exit <span className="text-foreground font-medium">{t.exit && t.exit !== t.entry ? t.exit : "open"}</span></span>
          <span>Size <span className="text-foreground font-medium">{t.size}</span></span>
        </div>
        {t.resultNote && <div className="mt-1 text-[11px] text-muted-foreground">{t.resultNote}</div>}
        {t.notes && <div className="mt-1 text-xs text-muted-foreground line-clamp-1">{t.notes}</div>}

      </button>
      <div className="text-right shrink-0">
        <div className={`font-semibold ${pnl > 0 ? "text-bull" : pnl < 0 ? "text-destructive" : ""}`}>
          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          R:R {rr == null ? "-" : `${rr.toFixed(2)}`}
        </div>
      </div>
      <ExecutedToggle t={t} onUpdate={onUpdate} />
      {t.resultSource !== "manual" && <CheckResultButton t={t} onUpdate={onUpdate} />}
      {t.threadId && (

        <Link
          to="/chat/$threadId"
          params={{ threadId: t.threadId }}
          className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-border/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40"
          title="Open the AI chat this trade came from"
        >
          <MessageSquare className="h-3 w-3" /> AI chat
        </Link>
      )}

      <button
        onClick={() => onDelete(t.id)}
        className="h-8 w-8 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
        aria-label="Delete trade"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function WinsLossesReview({ wins, losses, onEdit }: { wins: Trade[]; losses: Trade[]; onEdit: (t: Trade) => void }) {
  const winsPnl = wins.reduce((a, b) => a + tradePnl(b), 0);
  const lossesPnl = losses.reduce((a, b) => a + tradePnl(b), 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-bull/30 bg-bull/5 overflow-hidden">
        <div className="p-4 border-b border-bull/20 flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-tight text-bull/80">Winning trades</div>
            <div className="text-2xl font-semibold text-bull">+{winsPnl.toFixed(2)}</div>
          </div>
          <div className="text-xs text-muted-foreground">{wins.length}</div>
        </div>
        {wins.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">No winners logged yet.</div>
        ) : (
          <div className="divide-y divide-bull/10 max-h-[70vh] overflow-auto">
            {wins.map((t) => <MiniTradeRow key={t.id} t={t} onEdit={onEdit} />)}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
        <div className="p-4 border-b border-destructive/20 flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-tight text-destructive/80">Losing trades</div>
            <div className="text-2xl font-semibold text-destructive">{lossesPnl.toFixed(2)}</div>
          </div>
          <div className="text-xs text-muted-foreground">{losses.length}</div>
        </div>
        {losses.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">No losses logged. Nice.</div>
        ) : (
          <div className="divide-y divide-destructive/10 max-h-[70vh] overflow-auto">
            {losses.map((t) => <MiniTradeRow key={t.id} t={t} onEdit={onEdit} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniTradeRow({ t, onEdit }: { t: Trade; onEdit: (t: Trade) => void }) {
  const pnl = tradePnl(t);
  return (
    <button onClick={() => onEdit(t)} className="w-full flex items-center gap-3 p-3 text-left hover:bg-background/40 transition">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{t.symbol}</span>
          <span className="text-[10px] text-muted-foreground">{t.side} · {t.timeframe}</span>
          {t.setup && <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5">{t.setup}</span>}
          {t.ruleBroken && <span className="text-[10px] rounded bg-amber-500/15 text-amber-500 px-1.5 py-0.5">rule break</span>}
        </div>
        {t.lossCategory && <div className="mt-1 text-[11px] text-destructive/90">Cause: {t.lossCategory}</div>}
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground tabular-nums">
          <span>Entry <span className="text-foreground">{t.entry}</span></span>
          <span>Stop <span className="text-foreground">{t.stop || "-"}</span></span>
          <span>Exit <span className="text-foreground">{t.exit && t.exit !== t.entry ? t.exit : "open"}</span></span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{formatYmdHuman(t.date)}</div>

      </div>
      <div className={`text-sm font-semibold ${pnl >= 0 ? "text-bull" : "text-destructive"}`}>
        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
      </div>
    </button>
  );
}

function FilterBar({
  filter, onChange, allSymbols, views, viewName, onViewName,
  onSaveView, onLoadView, onDeleteView, onClear, filtered, total,
}: {
  filter: InsightsFilter;
  onChange: (f: InsightsFilter) => void;
  allSymbols: string[];
  views: SavedView[];
  viewName: string;
  onViewName: (s: string) => void;
  onSaveView: () => void;
  onLoadView: (v: SavedView) => void;
  onDeleteView: (id: string) => void;
  onClear: () => void;
  filtered: number;
  total: number;
}) {
  const toggleSymbol = (sym: string) => {
    const cur = new Set(filter.symbols ?? []);
    if (cur.has(sym)) cur.delete(sym); else cur.add(sym);
    onChange({ ...filter, symbols: Array.from(cur) });
  };
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold"><FilterIcon className="h-4 w-4 text-primary" /> Filters</div>
        <div className="text-xs text-muted-foreground">Showing {filtered} of {total} trades</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <div className="text-[10px] tracking-tight text-muted-foreground mb-1">From</div>
          <input type="date" value={filter.from ?? ""} onChange={(e) => onChange({ ...filter, from: e.target.value || undefined })}
            className="w-full rounded-xl border border-border/60 bg-background px-2 py-1.5 text-xs" />
        </label>
        <label className="block">
          <div className="text-[10px] tracking-tight text-muted-foreground mb-1">To</div>
          <input type="date" value={filter.to ?? ""} onChange={(e) => onChange({ ...filter, to: e.target.value || undefined })}
            className="w-full rounded-xl border border-border/60 bg-background px-2 py-1.5 text-xs" />
        </label>
        <label className="block">
          <div className="text-[10px] tracking-tight text-muted-foreground mb-1">Side</div>
          <select value={filter.side ?? "all"} onChange={(e) => onChange({ ...filter, side: e.target.value as InsightsFilter["side"] })}
            className="w-full rounded-xl border border-border/60 bg-background px-2 py-1.5 text-xs">
            <option value="all">All</option>
            <option value="Long">Long</option>
            <option value="Short">Short</option>
          </select>
        </label>
        <label className="block">
          <div className="text-[10px] tracking-tight text-muted-foreground mb-1">Rule break</div>
          <select value={filter.ruleBroken ?? "all"} onChange={(e) => onChange({ ...filter, ruleBroken: e.target.value as InsightsFilter["ruleBroken"] })}
            className="w-full rounded-xl border border-border/60 bg-background px-2 py-1.5 text-xs">
            <option value="all">All</option>
            <option value="yes">Only rule breaks</option>
            <option value="no">Only disciplined</option>
          </select>
        </label>
      </div>
      <label className="block">
        <div className="text-[10px] tracking-tight text-muted-foreground mb-1">Setup contains</div>
        <input value={filter.setup ?? ""} onChange={(e) => onChange({ ...filter, setup: e.target.value || undefined })}
          placeholder="e.g. UTAD"
          className="w-full rounded-xl border border-border/60 bg-background px-2 py-1.5 text-xs" />
      </label>
      {allSymbols.length > 0 && (
        <div>
          <div className="text-[10px] tracking-tight text-muted-foreground mb-1">Symbols</div>
          <div className="flex flex-wrap gap-1">
            {allSymbols.map((s) => {
              const active = (filter.symbols ?? []).includes(s);
              return (
                <button key={s} onClick={() => toggleSymbol(s)}
                  className={`text-[11px] rounded px-2 py-1 border ${active ? "border-primary bg-primary/15 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <input value={viewName} onChange={(e) => onViewName(e.target.value)} placeholder="Name this view"
          className="flex-1 min-w-[140px] rounded-xl border border-border/60 bg-background px-2 py-1.5 text-xs" />
        <button onClick={onSaveView} disabled={!viewName.trim()}
          className="inline-flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 text-primary px-2.5 py-1.5 text-xs disabled:opacity-40">
          <SaveIcon className="h-3 w-3" /> Save view
        </button>
        <button onClick={onClear} className="rounded-xl border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>
      {views.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {views.map((v) => (
            <div key={v.id} className="inline-flex items-center rounded border border-border/60">
              <button onClick={() => onLoadView(v)} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] hover:bg-accent/40">
                <Bookmark className="h-3 w-3" /> {v.name}
              </button>
              <button onClick={() => onDeleteView(v.id)} aria-label="Delete view"
                className="px-1.5 py-1 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InsightsPanel({ trades: allTrades }: { trades: Trade[] }) {

  const [filter, setFilter] = useState<InsightsFilter>({ side: "all", ruleBroken: "all" });
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");
  useEffect(() => { setViews(loadViews()); }, []);
  const trades = useMemo(() => applyFilter(allTrades, filter), [allTrades, filter]);
  const allSymbols = useMemo(() => Array.from(new Set(allTrades.map((t) => t.symbol))).sort(), [allTrades]);

  const stats = useMemo(() => {
    if (trades.length === 0) return null;
    const wins = trades.filter((t) => tradePnl(t) > 0);
    const losses = trades.filter((t) => tradePnl(t) < 0);
    const netPnl = trades.reduce((a, b) => a + tradePnl(b), 0);

    const ruleBrokenTrades = trades.filter((t) => t.ruleBroken);
    const ruleBrokenPnl = ruleBrokenTrades.reduce((a, b) => a + tradePnl(b), 0);
    const disciplinedTrades = trades.filter((t) => !t.ruleBroken);
    const disciplinedPnl = disciplinedTrades.reduce((a, b) => a + tradePnl(b), 0);

    // Loss category breakdown
    const byCause = new Map<string, { count: number; pnl: number }>();
    for (const t of losses) {
      const key = t.lossCategory ?? "Uncategorized";
      const cur = byCause.get(key) ?? { count: 0, pnl: 0 };
      cur.count += 1;
      cur.pnl += tradePnl(t);
      byCause.set(key, cur);
    }
    const lossByCategory = Array.from(byCause.entries())
      .map(([cause, v]) => ({ cause, ...v }))
      .sort((a, b) => a.pnl - b.pnl);

    // By symbol
    const bySymbol = new Map<string, { count: number; wins: number; pnl: number }>();
    for (const t of trades) {
      const cur = bySymbol.get(t.symbol) ?? { count: 0, wins: 0, pnl: 0 };
      cur.count += 1;
      cur.pnl += tradePnl(t);
      if (tradePnl(t) > 0) cur.wins += 1;
      bySymbol.set(t.symbol, cur);
    }
    const perSymbol = Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, ...v, winRate: (v.wins / v.count) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);

    // By day-of-week
    const byDow = new Map<number, { count: number; pnl: number; wins: number }>();
    for (const t of trades) {
      const dow = parseYmd(t.date).getDay();
      const cur = byDow.get(dow) ?? { count: 0, pnl: 0, wins: 0 };
      cur.count += 1; cur.pnl += tradePnl(t);
      if (tradePnl(t) > 0) cur.wins += 1;
      byDow.set(dow, cur);
    }
    const dowNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const perDow = Array.from(byDow.entries())
      .map(([dow, v]) => ({ dow: dowNames[dow], ...v, winRate: (v.wins / v.count) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);

    // By setup
    const bySetup = new Map<string, { count: number; wins: number; pnl: number }>();
    for (const t of trades) {
      const key = (t.setup ?? "").trim();
      if (!key) continue;
      const cur = bySetup.get(key) ?? { count: 0, wins: 0, pnl: 0 };
      cur.count += 1; cur.pnl += tradePnl(t);
      if (tradePnl(t) > 0) cur.wins += 1;
      bySetup.set(key, cur);
    }
    const perSetup = Array.from(bySetup.entries())
      .map(([setup, v]) => ({ setup, ...v, winRate: (v.wins / v.count) * 100 }))
      .sort((a, b) => b.pnl - a.pnl);

    // Auto-detected patterns
    const patterns: string[] = [];
    const winRate = (wins.length / trades.length) * 100;
    patterns.push(`Overall win rate ${winRate.toFixed(0)}% across ${trades.length} trades.`);
    if (ruleBrokenTrades.length > 0) {
      patterns.push(`Rule breaks cost you ${ruleBrokenPnl.toFixed(2)} across ${ruleBrokenTrades.length} trades. When you followed your rules you netted ${disciplinedPnl.toFixed(2)}.`);
    }
    if (lossByCategory.length > 0) {
      const worst = lossByCategory[0];
      patterns.push(`Biggest loss driver: "${worst.cause}" (${worst.pnl.toFixed(2)} across ${worst.count} trades).`);
    }
    if (perSymbol.length > 1) {
      patterns.push(`Best instrument: ${perSymbol[0].symbol} (+${perSymbol[0].pnl.toFixed(2)}). Worst: ${perSymbol[perSymbol.length - 1].symbol} (${perSymbol[perSymbol.length - 1].pnl.toFixed(2)}).`);
    }
    if (perDow.length > 1) {
      patterns.push(`Strongest day: ${perDow[0].dow} (+${perDow[0].pnl.toFixed(2)}). Weakest: ${perDow[perDow.length - 1].dow} (${perDow[perDow.length - 1].pnl.toFixed(2)}).`);
    }
    if (perSetup.length > 0) {
      patterns.push(`Highest-edge setup: "${perSetup[0].setup}" (${perSetup[0].winRate.toFixed(0)}% win rate, ${perSetup[0].pnl.toFixed(2)} net).`);
    }

    return { netPnl, winRate, ruleBrokenPnl, ruleBrokenCount: ruleBrokenTrades.length,
      disciplinedPnl, disciplinedCount: disciplinedTrades.length,
      lossByCategory, perSymbol, perDow, perSetup, patterns };
  }, [trades]);

  const filterBar = (
    <FilterBar
      filter={filter}
      onChange={setFilter}
      allSymbols={allSymbols}
      views={views}
      viewName={viewName}
      onViewName={setViewName}
      onSaveView={() => {
        const name = viewName.trim();
        if (!name) return;
        const next: SavedView[] = [
          ...views.filter((v) => v.name !== name),
          { id: `v_${Date.now().toString(36)}`, name, filter },
        ];
        setViews(next); saveViews(next); setViewName("");
      }}
      onLoadView={(v) => setFilter(v.filter)}
      onDeleteView={(id) => { const next = views.filter((v) => v.id !== id); setViews(next); saveViews(next); }}
      onClear={() => setFilter({ side: "all", ruleBroken: "all" })}
      filtered={trades.length}
      total={allTrades.length}
    />
  );

  if (!stats) {
    return (
      <div className="space-y-4">
        {filterBar}
        <div className="rounded-xl border border-border/60 bg-card p-10 text-center text-sm text-muted-foreground">
          {allTrades.length === 0 ? "Log a few trades to unlock pattern insights." : "No trades match this filter."}
        </div>
      </div>
    );
  }

  const aiPrompt = encodeURIComponent(
    `Please review my trading journal and highlight my top 3 behavioral patterns, my biggest weaknesses, and 3 concrete actions I should take. Here is a compact summary:\n\n` +
    stats.patterns.join("\n") + `\n\nLoss categories: ` +
    stats.lossByCategory.map((c) => `${c.cause}: ${c.pnl.toFixed(2)} (${c.count})`).join("; ")
  );

  return (
    <div className="space-y-4">
      {filterBar}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Net P&L" value={`${stats.netPnl >= 0 ? "+" : ""}${stats.netPnl.toFixed(2)}`} positive={stats.netPnl >= 0} />
        <StatCard label="Win rate" value={`${stats.winRate.toFixed(0)}%`} positive={stats.winRate >= 50} />
        <StatCard label="Rule-break P&L" value={`${stats.ruleBrokenPnl >= 0 ? "+" : ""}${stats.ruleBrokenPnl.toFixed(2)}`} positive={stats.ruleBrokenPnl >= 0} sub={`${stats.ruleBrokenCount} trades`} />
        <StatCard label="Disciplined P&L" value={`${stats.disciplinedPnl >= 0 ? "+" : ""}${stats.disciplinedPnl.toFixed(2)}`} positive={stats.disciplinedPnl >= 0} sub={`${stats.disciplinedCount} trades`} />
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Auto-detected patterns</h3>
          <Link
            to="/dashboard"
            search={{ ask: decodeURIComponent(aiPrompt) } as never}
            className="text-xs rounded-xl border border-primary/30 bg-primary/10 text-primary px-2.5 py-1.5 hover:bg-primary/20"
          >
            Ask AI to analyze
          </Link>
        </div>
        <ul className="space-y-2 text-sm">
          {stats.patterns.map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-border/60 bg-card p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" /> Losses by cause
        </h3>
        {stats.lossByCategory.length === 0 ? (
          <div className="text-xs text-muted-foreground">No losing trades logged yet.</div>
        ) : (
          <div className="space-y-2">
            {stats.lossByCategory.map((c) => {
              const worst = stats.lossByCategory[0].pnl;
              const pct = Math.min(100, (c.pnl / worst) * 100);
              return (
                <div key={c.cause} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground/80">{c.cause}</span>
                    <span className="text-destructive font-semibold">{c.pnl.toFixed(2)} <span className="text-muted-foreground font-normal">({c.count})</span></span>
                  </div>
                  <div className="h-1.5 bg-destructive/10 rounded overflow-hidden">
                    <div className="h-full bg-destructive/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BreakdownList title="By instrument" rows={stats.perSymbol.map((r) => ({ label: r.symbol, pnl: r.pnl, winRate: r.winRate, count: r.count }))} />
        <BreakdownList title="By day of week" rows={stats.perDow.map((r) => ({ label: r.dow, pnl: r.pnl, winRate: r.winRate, count: r.count }))} />
      </div>

      {stats.perSetup.length > 0 && (
        <BreakdownList title="By setup / pattern" rows={stats.perSetup.map((r) => ({ label: r.setup, pnl: r.pnl, winRate: r.winRate, count: r.count }))} />
      )}
    </div>
  );
}

function StatCard({ label, value, positive, sub }: { label: string; value: string; positive: boolean; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-[10px] tracking-tight text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${positive ? "text-bull" : "text-destructive"}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: { label: string; pnl: number; winRate: number; count: number }[] }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-xs rounded border border-border/40 px-2 py-1.5">
            <span className="font-medium">{r.label}</span>
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>{r.count}</span>
              <span>{r.winRate.toFixed(0)}%</span>
              <span className={`font-semibold ${r.pnl >= 0 ? "text-bull" : "text-destructive"}`}>
                {r.pnl >= 0 ? "+" : ""}{r.pnl.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeFormModal({
  initialDate,
  editing,
  prefill,
  onClose,
  onSave,
}: {
  initialDate: string;
  editing: Trade | null;
  prefill?: { symbol?: string; timeframe?: string; notes?: string; entry?: number; stop?: number; tp1?: number; tp2?: number; side?: Side; setup?: string; threadId?: string } | null;
  onClose: () => void;
  onSave: (t: Trade) => void;
}) {
  const [date, setDate] = useState(editing?.date ?? initialDate);
  const [timeframe, setTimeframe] = useState<Timeframe>(
    editing?.timeframe ?? (TIMEFRAMES.includes((prefill?.timeframe ?? "") as Timeframe) ? (prefill!.timeframe as Timeframe) : "1H"),
  );
  const [symbol, setSymbol] = useState(editing?.symbol ?? prefill?.symbol ?? "XAU/USD");
  const [side, setSide] = useState<Side>(editing?.side ?? prefill?.side ?? "Long");
  const [entry, setEntry] = useState<string>(editing ? String(editing.entry) : prefill?.entry != null ? String(prefill.entry) : "");
  const [exit, setExit] = useState<string>(editing ? String(editing.exit) : "");
  const [stop, setStop] = useState<string>(editing ? String(editing.stop) : prefill?.stop != null ? String(prefill.stop) : "");
  const [takeProfit, setTakeProfit] = useState<string>(editing?.takeProfit != null ? String(editing.takeProfit) : prefill?.tp1 != null ? String(prefill.tp1) : "");
  // Unrealistic entry / stop / target combinations get explained inline instead
  // of silently saving a plan whose R math cannot be right.
  const levelIssues = useMemo(
    () =>
      validateLevels({
        side,
        entry: entry.trim() ? Number(entry) : null,
        stop: stop.trim() ? Number(stop) : null,
        target: takeProfit.trim() ? Number(takeProfit) : null,
      }),
    [side, entry, stop, takeProfit],
  );
  const [size, setSize] = useState<string>(editing ? String(editing.size) : "1");
  const [fees, setFees] = useState<string>(editing?.fees != null ? String(editing.fees) : "");
  const [pointValue, setPointValue] = useState<string>(editing?.pointValue != null ? String(editing.pointValue) : "");
  const [notes, setNotes] = useState(editing?.notes ?? prefill?.notes ?? "");
  const [chatLog, setChatLog] = useState(editing?.chatLog ?? "");
  const [setup, setSetup] = useState(editing?.setup ?? prefill?.setup ?? "");
  const [ruleBroken, setRuleBroken] = useState<boolean>(editing?.ruleBroken ?? false);
  const [ruleBrokenNote, setRuleBrokenNote] = useState<string>(editing?.ruleBrokenNote ?? "");
  const [lossCategory, setLossCategory] = useState<LossCategory | "">(editing?.lossCategory ?? "");
  const [followedPlan, setFollowedPlan] = useState<boolean>(editing?.followedPlan ?? true);
  const [gradeMatch, setGradeMatch] = useState<"yes" | "no" | "partial" | "">(editing?.gradeMatch ?? "");
  const [takeaway, setTakeaway] = useState<string>(editing?.takeaway ?? "");
  const [result, setResult] = useState<TradeResult | "">(editing?.result ?? "");

  // Mental state for this trade's date — two birds, one stone.
  const [mentalScore, setMentalScore] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [mentalMood, setMentalMood] = useState("");
  useEffect(() => {
    try {
      const existing = loadMental().find((e) => e.date === date);
      setMentalScore(existing?.score ?? null);
      setMentalMood(existing?.mood ?? "");
    } catch { /* ignore */ }
  }, [date]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Multiple screenshots per trade: before/after, higher timeframe, execution.
  const [images, setImages] = useState<{ blob: Blob; url: string }[]>([]);
  const [imagesDirty, setImagesDirty] = useState(false);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    if (editing?.hasImage) {
      void getTradeImages(editing.id, editing.imageCount ?? 1).then((blobs) => {
        if (!active) return;
        const next = blobs.map((blob) => {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          return { blob, url };
        });
        setImages(next);
      });
    }
    return () => { active = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [editing?.id, editing?.hasImage, editing?.imageCount]);

  // Five frames per trade: 4H, 1H, 15m, 5m, 1m. More than that is noise and the
  // reader cannot use it, so extra files are dropped with a note.
  const MAX_TRADE_IMAGES = 5;
  const handlePickFiles = async (files: FileList | File[] | null | undefined) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const added: { blob: Blob; url: string }[] = [];
    for (const file of list.slice(0, MAX_TRADE_IMAGES)) {
      const compressed = await compressImageFile(file);
      added.push({ blob: compressed, url: URL.createObjectURL(compressed) });
    }
    setImages((prev) => {
      const next = [...prev, ...added].slice(0, MAX_TRADE_IMAGES);
      if (prev.length + added.length > MAX_TRADE_IMAGES) {
        setAutofillNote(`Up to ${MAX_TRADE_IMAGES} images per trade (4H, 1H, 15m, 5m, 1m). The extras were skipped.`);
      }
      return next;
    });
    setImagesDirty(true);
  };

  // Read the numbers off an uploaded chart screenshot and drop them into the
  // form. Existing values are only overwritten when the reader found something.
  const [autofilling, setAutofilling] = useState(false);
  const [autofillNote, setAutofillNote] = useState("");
  const autofillFromScreenshot = async () => {
    if (!images.length || autofilling) return;
    setAutofilling(true);
    setAutofillNote("");
    try {
      const dataUrls = await Promise.all(
        images.slice(0, MAX_TRADE_IMAGES).map(
          (img) =>
            new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result || ""));
              r.onerror = reject;
              r.readAsDataURL(img.blob);
            }),
        ),
      );
      const out = await parseTradeSetupScreenshot({ data: { images: dataUrls, hint: notes.trim() || undefined } });
      if (out.symbol) setSymbol(out.symbol);
      if (out.side) setSide(out.side);
      if (out.timeframe && TIMEFRAMES.includes(out.timeframe as Timeframe)) setTimeframe(out.timeframe as Timeframe);
      if (out.entry != null) setEntry(String(out.entry));
      if (out.stop != null) setStop(String(out.stop));
      if (out.takeProfit != null) setTakeProfit(String(out.takeProfit));
      if (out.exit != null) setExit(String(out.exit));
      if (out.size != null && out.size > 0) setSize(String(out.size));
      if (out.notes) setNotes((prev) => (prev.trim() ? prev : out.notes!));
      const filled = out.entry != null || out.stop != null || out.takeProfit != null;
      const conf = out.confidence != null ? ` Confidence ${Math.round(out.confidence * 100)}%.` : "";
      setAutofillNote(
        filled
          ? `${out.note || "Levels read from the chart."}${conf} Check the numbers before saving.`
          : out.note || "No levels could be read from that screenshot.",
      );
    } catch {
      setAutofillNote("Could not read that screenshot. Try again in a moment.");
    } finally {
      setAutofilling(false);
    }
  };

  const [pasteBox, setPasteBox] = useState("");
  const [textFilling, setTextFilling] = useState(false);
  const [textNote, setTextNote] = useState("");

  // Same idea as the screenshot reader, but for pasted text: broker fills,
  // signal messages, or the trader's own write-up.
  const autofillFromText = async () => {
    const text = pasteBox.trim();
    if (text.length < 4 || textFilling) return;
    setTextFilling(true);
    setTextNote("");
    try {
      const out = await parseTradeSetupText({ data: { text: text.slice(0, 4000) } });
      if (out.symbol) setSymbol(out.symbol);
      if (out.side) setSide(out.side);
      if (out.timeframe && TIMEFRAMES.includes(out.timeframe as Timeframe)) setTimeframe(out.timeframe as Timeframe);
      if (out.entry != null) setEntry(String(out.entry));
      if (out.stop != null) setStop(String(out.stop));
      if (out.takeProfit != null) setTakeProfit(String(out.takeProfit));
      if (out.exit != null) setExit(String(out.exit));
      if (out.size != null && out.size > 0) setSize(String(out.size));
      setNotes((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${text}` : text));
      const filled = out.entry != null || out.stop != null || out.takeProfit != null;
      const conf = out.confidence != null ? ` Confidence ${Math.round(out.confidence * 100)}%.` : "";
      setTextNote(
        filled
          ? `${out.note || "Levels read from your text."}${conf} Check the numbers before saving.`
          : out.note || "No levels could be read from that text.",
      );
      if (filled) setPasteBox("");
    } catch {
      setTextNote("Could not read that text. Try again in a moment.");
    } finally {
      setTextFilling(false);
    }
  };

  const removeImageAt = (i: number) => {
    setImages((prev) => {
      const target = prev[i];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, idx) => idx !== i);
    });
    setImagesDirty(true);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) void handlePickFiles(files);

      // Pasted text lands in Notes so a screenshot and the write-up can be
      // dropped in together. Skipped when the cursor is already in a field,
      // so normal typing/pasting into inputs still behaves normally.
      const el = e.target as HTMLElement | null;
      const inField = !!el?.closest?.("input, textarea, select, [contenteditable='true']");
      const text = e.clipboardData?.getData("text/plain")?.trim() ?? "";
      if (!inField && text) {
        e.preventDefault();
        setNotes((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${text}` : text));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A chart captured on the dashboard ("Journal" button on the live chart) is
  // parked in localStorage; pull it in once, with its levels already drawn on.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = localStorage.getItem("tm_pending_chart_shot");
        if (!raw) return;
        localStorage.removeItem("tm_pending_chart_shot");
        const parsed = JSON.parse(raw) as { dataUrl?: string; ticker?: string; interval?: string };
        if (!parsed?.dataUrl?.startsWith("data:image/")) return;
        const blob = await (await fetch(parsed.dataUrl)).blob();
        if (cancelled) return;
        const file = new File([blob], "trademind-chart.png", { type: blob.type || "image/png" });
        await handlePickFiles([file]);
        setAutofillNote(
          `Attached your ${parsed.ticker ?? "chart"}${parsed.interval ? ` ${parsed.interval}` : ""} capture with levels.`,
        );
      } catch {
        // A stale or oversized entry is not worth interrupting the page for.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // A conversation staged by the "To journal" button in the coach chat is
  // attached to this entry once, so the reasoning behind the trade is saved
  // with it and syncs to every device.
  useEffect(() => {
    const pending = takePendingChatLog();
    if (!pending) return;
    setChatLog((prev) => (prev.trim() ? prev : pending.text));
    setAutofillNote(
      `Attached your ${pending.instrument ?? "coach"} conversation to this trade.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasImage = images.length > 0;

  // A trade you just took has no exit yet. Treat a blank exit as "still open"
  // and fall back to the entry so P&L reads 0 until the trade is closed.
  const effectiveExit = exit === "" ? Number(entry) || 0 : Number(exit) || 0;

  const preview: Trade = {
    id: editing?.id ?? "preview",
    date,
    timeframe,
    symbol,
    side,
    entry: Number(entry) || 0,
    exit: effectiveExit,
    stop: Number(stop) || 0,
    takeProfit: takeProfit === "" ? undefined : Number(takeProfit),
    size: Number(size) || 0,
    fees: fees === "" ? undefined : Number(fees),
    pointValue: pointValue === "" ? undefined : Number(pointValue),

    notes,
    setup: setup.trim() || undefined,
    ruleBroken: ruleBroken || undefined,
    ruleBrokenNote: ruleBroken ? (ruleBrokenNote || undefined) : undefined,
    lossCategory: lossCategory || undefined,
    hasImage,
    imageCount: images.length || undefined,
    executed: editing?.executed,
    executedAt: editing?.executedAt,
    followedPlan: followedPlan || undefined,
    gradeMatch: gradeMatch || undefined,
    takeaway: takeaway.trim() || undefined,
    result: result || undefined,
    resultSource: result ? (result === editing?.result ? editing?.resultSource ?? "manual" : "manual") : undefined,
    resultR: result && result !== editing?.result ? null : editing?.resultR ?? null,
    resultNote:
      result && result !== editing?.result ? "Result set by hand in the journal." : editing?.resultNote,
    resultCheckedAt: result ? Date.now() : editing?.resultCheckedAt,
    threadId: editing?.threadId ?? prefill?.threadId,
    chatLog: chatLog.trim() || undefined,
    chatLogSavedAt: chatLog.trim() ? editing?.chatLogSavedAt ?? Date.now() : undefined,
    createdAt: editing?.createdAt ?? Date.now(),
  };
  const previewPnl = tradePnl(preview);
  const previewRR = tradeRR(preview);
  const previewPlannedRR = plannedRR(preview);
  const isLoss = previewPnl < 0;

  // Exit is optional: an open trade can be logged in one click.
  const canSave = !!(symbol.trim() && entry !== "" && stop !== "" && date);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!canSave) return;

    const id = editing?.id ?? `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    if (imagesDirty || !editing) {
      await deleteTradeImages(id, Math.max(12, editing?.imageCount ?? 1));
      if (images.length) await putTradeImages(id, images.map((i) => i.blob));
    }
    if (mentalScore != null) {
      const existing = loadMental().find((e) => e.date === date);
      const entryToSave: MentalEntry = {
        ...(existing ?? { date, createdAt: Date.now(), score: mentalScore }),
        date,
        score: mentalScore,
        mood: mentalMood.trim() || existing?.mood,
      };
      upsertMentalEntry(entryToSave);
    }
    onSave({ ...preview, id });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border/60 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border/60">
          <div>
            <div className="text-[11px] tracking-[0.2em] text-muted-foreground">
              {editing ? "Edit trade" : "Log trade"}
            </div>
            <h2 className="font-display text-xl font-semibold">{formatYmdHuman(date)}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Upload image to capture numbers">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { void handlePickFiles(e.target.files); e.target.value = ""; }}
            />
            {images.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                {images.map((img, i) => (
                  <div key={img.url} className="relative rounded-xl border border-border/60 overflow-hidden bg-background">
                    <img src={img.url} alt={`Trade screenshot ${i + 1}`} className="w-full max-h-48 object-contain" />
                    <button
                      type="button"
                      onClick={() => removeImageAt(i)}
                      className="absolute top-1.5 right-1.5 rounded bg-background/80 px-2 py-1 text-[10px] font-medium border border-border/60 text-destructive hover:bg-destructive/10"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition flex flex-col items-center gap-1.5"
            >
              <Upload className="h-4 w-4" />
              <span>{images.length ? "Add another screenshot" : "Upload a TradingView screenshot"}</span>
              <span className="text-[10px]">We read entry, stop, target and size off the image. Stays on this device.</span>
            </button>
            {images.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  disabled={autofilling}
                  onClick={() => void autofillFromScreenshot()}
                  className="w-full rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 transition disabled:opacity-60"
                >
                  {autofilling ? "Reading the chart…" : "Fill fields from screenshot"}
                </button>
                {autofillNote && (
                  <div className="mt-1.5 text-[11px] text-muted-foreground">{autofillNote}</div>
                )}
              </div>
            )}

            {/* Paste text: broker fill, signal message or your own write-up.
                Right-click paste only works inside an editable box, so this
                textarea also doubles as an image paste target. */}
            <div className="mt-3">
              <div className="text-[11px] text-muted-foreground mb-1">Or paste trade text</div>
              <textarea
                rows={3}
                value={pasteBox}
                onChange={(e) => setPasteBox(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData?.items ?? [])
                    .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
                    .map((i) => i.getAsFile())
                    .filter((f): f is File => !!f);
                  if (files.length) {
                    e.preventDefault();
                    void handlePickFiles(files);
                  }
                }}
                placeholder="Paste your fill, signal or notes here (Ctrl+V). Images paste here too."
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
              />
              <button
                type="button"
                disabled={textFilling || pasteBox.trim().length < 4}
                onClick={() => void autofillFromText()}
                className="mt-2 w-full rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15 transition disabled:opacity-50"
              >
                {textFilling ? "Reading the text…" : "Fill fields from text"}
              </button>
              {textNote && <div className="mt-1.5 text-[11px] text-muted-foreground">{textNote}</div>}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </Field>
            <Field label="Timeframe">
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              >
                {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="XAU/USD"
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </Field>
            <Field label="Side">
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 p-1">
                {(["Long","Short"] as Side[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSide(s)}
                    className={`rounded px-2 py-1.5 text-xs font-medium transition ${
                      side === s
                        ? s === "Long" ? "bg-bull/15 text-bull" : "bg-destructive/15 text-destructive"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Entry">
              <input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Stop">
              <input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Take profit">
              <input inputMode="decimal" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="planned" className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Exit (leave blank if still open)">
              <input inputMode="decimal" value={exit} onChange={(e) => setExit(e.target.value)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
          </div>

          {/* Sanity check on the levels the trader typed, with a one-tap fix. */}
          <LevelWarnings
            issues={levelIssues}
            onApply={(i) => {
              if (i.suggestedValue == null) return;
              const v = String(i.suggestedValue);
              if (i.field === "entry") setEntry(v);
              else if (i.field === "stop") setStop(v);
              else setTakeProfit(v);
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Size (units / contracts)">
              <input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Setup / pattern (optional)">
              <input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. UTAD, Breakout" className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Point value ($/unit, optional)">
              <input inputMode="decimal" value={pointValue} onChange={(e) => setPointValue(e.target.value)} placeholder="1 = raw price" className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Fees / commission ($)">
              <input inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
          </div>


          <div className="rounded-2xl border border-border/60 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ruleBroken}
                onChange={(e) => setRuleBroken(e.target.checked)}
                className="h-4 w-4 rounded border-border/60"
              />
              <span>I broke one of my trading rules on this trade</span>
            </label>
            {ruleBroken && (
              <input
                value={ruleBrokenNote}
                onChange={(e) => setRuleBrokenNote(e.target.value)}
                placeholder="Which rule? (e.g. traded outside plan hours)"
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            )}
          </div>

          {isLoss && (
            <Field label="What caused this loss?">
              <select
                value={lossCategory}
                onChange={(e) => setLossCategory(e.target.value as LossCategory | "")}
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                <option value="">Uncategorized</option>
                {LOSS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          )}

          <div className="rounded-2xl border border-border/60 p-3 space-y-3">
            <div className="text-sm font-semibold">Trade review checklist</div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={followedPlan}
                  onChange={(e) => setFollowedPlan(e.target.checked)}
                  className="h-4 w-4 rounded border-border/60"
                />
                <span>I followed my plan</span>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["yes", "no", "partial"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGradeMatch(g)}
                  className={`rounded-xl border px-2 py-1.5 text-xs font-medium transition ${
                    gradeMatch === g
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Grade match: {g}
                </button>
              ))}
            </div>
            <Field label="Result of this trade">
              <select
                value={result}
                onChange={(e) => setResult(e.target.value as TradeResult | "")}
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              >
                {MANUAL_RESULTS.map((r) => (
                  <option key={r.value || "none"} value={r.value}>{r.label}</option>
                ))}
              </select>
            </Field>
            <input
              value={takeaway}
              onChange={(e) => setTakeaway(e.target.value)}
              placeholder="One takeaway from this trade (e.g. 'wait for confirmation')"
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </div>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What was the setup? What did you see? Paste text or a screenshot here."
              className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/50"
            />
          </Field>

          {chatLog.trim() && (
            <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
              <div className="flex items-center gap-2 mb-2">
                <NotebookPen className="h-4 w-4 text-primary" />
                <div className="text-sm font-semibold">Coaching conversation</div>
                <button
                  type="button"
                  onClick={() => setChatLog("")}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Remove
                </button>
              </div>
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                {chatLog}
              </pre>
              <p className="mt-2 text-[10px] text-muted-foreground">Saved with this trade and synced to your other devices.</p>
            </div>
          )}


          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center gap-2 mb-2">
              <HeartPulse className="h-4 w-4 text-primary" />
              <div className="text-sm font-semibold">Mental state for this day</div>
              <div className="text-[10px] text-muted-foreground ml-auto">optional, saves to your daily log</div>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {([1, 2, 3, 4, 5] as const).map((n) => {
                const meta = SCORE_META[n];
                const active = mentalScore === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMentalScore(active ? null : n)}
                    className={`rounded-2xl border p-2 text-center transition ${active ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/40"}`}
                  >
                    <div className={`text-lg font-bold ${meta.color}`}>{n}</div>
                    <div className="text-[10px] text-muted-foreground">{meta.label}</div>
                  </button>
                );
              })}
            </div>
            {mentalScore != null && (
              <input
                value={mentalMood}
                onChange={(e) => setMentalMood(e.target.value)}
                placeholder="Mood in a word (focused, tired, anxious...)"
                className="mt-3 w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            )}
          </div>


          <div className="rounded-2xl border border-border/60 bg-background/50 p-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[10px] tracking-[0.2em] text-muted-foreground">P&amp;L</div>
              <div className={`font-semibold ${previewPnl > 0 ? "text-bull" : previewPnl < 0 ? "text-destructive" : ""}`}>
                {previewPnl >= 0 ? "+" : ""}{previewPnl.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.2em] text-muted-foreground">R:R (actual)</div>
              <div className="font-semibold">{previewRR == null ? "-" : previewRR.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.2em] text-muted-foreground">R:R (planned)</div>
              <div className="font-semibold">{previewPlannedRR == null ? "-" : previewPlannedRR.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-border/60">
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            disabled={!canSave || saving}
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try {
                await Promise.resolve(submit());
              } finally {
                setSaving(false);
              }
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <ActionLoader label={editing ? "Saving changes" : "Logging trade"} size="sm" inline />
            ) : editing ? (
              "Save changes"
            ) : (
              "Log trade"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const FIELD_TIPS: Record<string, string> = {
  "Entry": "entry",
  "Stop": "stop",
  "Take profit": "tp1",
  "Timeframe": "htf",
  "Size (units / contracts)": "r",
  "Setup / pattern (optional)": "orderBlock",
  "Result of this trade": "pnl",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const tip = FIELD_TIPS[label];
  return (
    <label className="block">
      <div className="flex items-center gap-1 text-[10px] tracking-[0.2em] text-muted-foreground mb-1.5">{label}{tip ? <InfoTip id={tip} /> : null}</div>
      {children}
    </label>
  );
}

function TradeThumb({ tradeId }: { tradeId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let created: string | null = null;
    void getTradeImage(tradeId).then((blob) => {
      if (!active || !blob) return;
      created = URL.createObjectURL(blob);
      setUrl(created);
    });
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [tradeId]);
  if (!url) {
    return (
      <div className="h-12 w-16 rounded border border-border/60 bg-background/40 flex items-center justify-center text-muted-foreground shrink-0">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Trade screenshot"
      className="h-12 w-16 rounded border border-border/60 object-cover shrink-0"
    />
  );
}
