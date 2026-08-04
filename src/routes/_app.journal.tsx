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
} from "lucide-react";
import { MentalStatePanel, upsertMentalEntry, SCORE_META, loadMental, type MentalEntry } from "@/components/MentalStatePanel";
import JournalReviewPanel from "@/components/JournalReviewPanel";

import { exportMyData } from "@/lib/privacy.functions";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

import {
  putTradeImage,
  getTradeImage,
  deleteTradeImage,
  compressImageFile,
} from "@/lib/journalImages";

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
  ruleBroken?: boolean;
  ruleBrokenNote?: string;
  lossCategory?: LossCategory;
  setup?: string;         // free-text pattern tag e.g. "UTAD", "Breakout"
  createdAt: number;
};

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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trades)); } catch { /* ignore */ }
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportTradesCsv(trades: Trade[]) {
  const headers = ["date","timeframe","symbol","side","entry","exit","stop","takeProfit","size","pointValue","fees","pnl","rr","plannedRR","ruleBroken","ruleBrokenNote","lossCategory","setup","notes"];
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
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<string>(todayYmd());
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setTrades(loadTrades()); }, []);
  useEffect(() => { saveTrades(trades); }, [trades]);

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
    emitFirstWeekEvent("journal-log");
  };
  const handleDelete = (id: string) => {
    setTrades((prev) => prev.filter((p) => p.id !== id));
    void deleteTradeImage(id);
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
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
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
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Log trade
        </button>
      </div>

      {tab === "calendar" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between px-2 sm:px-4 py-2 mb-2">
            <button
              onClick={() => setCursor(new Date(year, month - 1, 1))}
              className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="font-display text-base sm:text-lg tracking-wider">
              {MONTH_NAMES[month]} {year}
            </div>
            <button
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              className="h-8 w-8 rounded-md hover:bg-accent flex items-center justify-center"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-[10px] sm:text-xs text-muted-foreground font-mono border-b border-border">
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
                  onClick={() => openNew(dateStr)}
                  className={`group relative aspect-[5/4] border-b border-r border-border/40 p-1.5 sm:p-2 text-left transition hover:bg-accent/40 ${
                    isToday ? "bg-primary/5" : ""
                  }`}
                  title={`Add trade on ${formatYmdHuman(dateStr)}`}
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

      {tab === "trades" && (
        <TradesList
          trades={sortedTrades}
          onEdit={openEdit}
          onDelete={handleDelete}
          onImport={(merged) => setTrades(merged)}
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
  trades, onEdit, onDelete, onImport,
}: {
  trades: Trade[];
  onEdit: (t: Trade) => void;
  onDelete: (id: string) => void;
  onImport: (merged: Trade[]) => void;
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
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border/60 bg-card/60">
        <div className="text-xs text-muted-foreground">
          {trades.length} {trades.length === 1 ? "trade" : "trades"}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => exportTradesCsv(trades)}
            disabled={trades.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-accent/40 transition disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            onClick={() => exportBackupJson(trades)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-accent/40 transition"
          >
            <DatabaseBackup className="h-3.5 w-3.5" /> Backup (JSON)
          </button>
          <button
            onClick={() => restoreInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-accent/40 transition"
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
            <TradeRow key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}


function TradeRow({ t, onEdit, onDelete }: { t: Trade; onEdit: (t: Trade) => void; onDelete: (id: string) => void }) {
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
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1.5 py-0.5">
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
        </div>
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
      <button
        onClick={() => onDelete(t.id)}
        className="h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
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
            <div className="text-[10px] uppercase tracking-widest text-bull/80">Winning trades</div>
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
            <div className="text-[10px] uppercase tracking-widest text-destructive/80">Losing trades</div>
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
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold"><FilterIcon className="h-4 w-4 text-primary" /> Filters</div>
        <div className="text-xs text-muted-foreground">Showing {filtered} of {total} trades</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">From</div>
          <input type="date" value={filter.from ?? ""} onChange={(e) => onChange({ ...filter, from: e.target.value || undefined })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
        </label>
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">To</div>
          <input type="date" value={filter.to ?? ""} onChange={(e) => onChange({ ...filter, to: e.target.value || undefined })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
        </label>
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Side</div>
          <select value={filter.side ?? "all"} onChange={(e) => onChange({ ...filter, side: e.target.value as InsightsFilter["side"] })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
            <option value="all">All</option>
            <option value="Long">Long</option>
            <option value="Short">Short</option>
          </select>
        </label>
        <label className="block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Rule break</div>
          <select value={filter.ruleBroken ?? "all"} onChange={(e) => onChange({ ...filter, ruleBroken: e.target.value as InsightsFilter["ruleBroken"] })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs">
            <option value="all">All</option>
            <option value="yes">Only rule breaks</option>
            <option value="no">Only disciplined</option>
          </select>
        </label>
      </div>
      <label className="block">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Setup contains</div>
        <input value={filter.setup ?? ""} onChange={(e) => onChange({ ...filter, setup: e.target.value || undefined })}
          placeholder="e.g. UTAD"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
      </label>
      {allSymbols.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Symbols</div>
          <div className="flex flex-wrap gap-1">
            {allSymbols.map((s) => {
              const active = (filter.symbols ?? []).includes(s);
              return (
                <button key={s} onClick={() => toggleSymbol(s)}
                  className={`text-[11px] rounded px-2 py-1 border ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <input value={viewName} onChange={(e) => onViewName(e.target.value)} placeholder="Name this view"
          className="flex-1 min-w-[140px] rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
        <button onClick={onSaveView} disabled={!viewName.trim()}
          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 text-primary px-2.5 py-1.5 text-xs disabled:opacity-40">
          <SaveIcon className="h-3 w-3" /> Save view
        </button>
        <button onClick={onClear} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>
      {views.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {views.map((v) => (
            <div key={v.id} className="inline-flex items-center rounded border border-border">
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
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
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

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Auto-detected patterns</h3>
          <Link
            to="/dashboard"
            search={{ ask: decodeURIComponent(aiPrompt) } as never}
            className="text-xs rounded-md border border-primary/30 bg-primary/10 text-primary px-2.5 py-1.5 hover:bg-primary/20"
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

      <div className="rounded-xl border border-border bg-card p-4">
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
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${positive ? "text-bull" : "text-destructive"}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: { label: string; pnl: number; winRate: number; count: number }[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
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
  prefill?: { symbol?: string; timeframe?: string; notes?: string; entry?: number; stop?: number; tp1?: number; tp2?: number; side?: Side; setup?: string } | null;
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
  const [size, setSize] = useState<string>(editing ? String(editing.size) : "1");
  const [fees, setFees] = useState<string>(editing?.fees != null ? String(editing.fees) : "");
  const [pointValue, setPointValue] = useState<string>(editing?.pointValue != null ? String(editing.pointValue) : "");
  const [notes, setNotes] = useState(editing?.notes ?? prefill?.notes ?? "");
  const [setup, setSetup] = useState(editing?.setup ?? prefill?.setup ?? "");
  const [ruleBroken, setRuleBroken] = useState<boolean>(editing?.ruleBroken ?? false);
  const [ruleBrokenNote, setRuleBrokenNote] = useState<string>(editing?.ruleBrokenNote ?? "");
  const [lossCategory, setLossCategory] = useState<LossCategory | "">(editing?.lossCategory ?? "");

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
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => {
    let revokedUrl: string | null = null;
    if (editing?.hasImage) {
      void getTradeImage(editing.id).then((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          revokedUrl = url;
          setImageUrl(url);
        }
      });
    }
    return () => { if (revokedUrl) URL.revokeObjectURL(revokedUrl); };
  }, [editing?.id, editing?.hasImage]);

  const handlePickFile = async (file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const compressed = await compressImageFile(file);
    setPendingImage(compressed);
    setRemoveImage(false);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(URL.createObjectURL(compressed));
  };

  const clearImage = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setPendingImage(null);
    setRemoveImage(true);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (file) void handlePickFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasImage = !!pendingImage || (!!editing?.hasImage && !removeImage);

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
    createdAt: editing?.createdAt ?? Date.now(),
  };
  const previewPnl = tradePnl(preview);
  const previewRR = tradeRR(preview);
  const previewPlannedRR = plannedRR(preview);
  const isLoss = previewPnl < 0;

  // Exit is optional: an open trade can be logged in one click.
  const canSave = !!(symbol.trim() && entry !== "" && stop !== "" && date);

  const submit = async () => {
    if (!canSave) return;

    const id = editing?.id ?? `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    if (pendingImage) {
      await putTradeImage(id, pendingImage);
    } else if (removeImage && editing?.hasImage) {
      await deleteTradeImage(id);
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
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border/60">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {editing ? "Edit trade" : "Log trade"}
            </div>
            <h2 className="font-display text-xl font-semibold">{formatYmdHuman(date)}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </Field>
            <Field label="Timeframe">
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as Timeframe)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
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
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </Field>
            <Field label="Side">
              <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-1">
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
              <input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Stop">
              <input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Take profit">
              <input inputMode="decimal" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="planned" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Exit (leave blank if still open)">
              <input inputMode="decimal" value={exit} onChange={(e) => setExit(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Size (units / contracts)">
              <input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Setup / pattern (optional)">
              <input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. UTAD, Breakout" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Point value ($/unit, optional)">
              <input inputMode="decimal" value={pointValue} onChange={(e) => setPointValue(e.target.value)} placeholder="1 = raw price" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Fees / commission ($)">
              <input inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
          </div>


          <div className="rounded-lg border border-border p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ruleBroken}
                onChange={(e) => setRuleBroken(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              <span>I broke one of my trading rules on this trade</span>
            </label>
            {ruleBroken && (
              <input
                value={ruleBrokenNote}
                onChange={(e) => setRuleBrokenNote(e.target.value)}
                placeholder="Which rule? (e.g. traded outside plan hours)"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            )}
          </div>

          {isLoss && (
            <Field label="What caused this loss?">
              <select
                value={lossCategory}
                onChange={(e) => setLossCategory(e.target.value as LossCategory | "")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Uncategorized</option>
                {LOSS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          )}

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="What was the setup? What did you see?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/50"
            />
          </Field>

          <Field label="Chart screenshot (stays on this device)">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { void handlePickFile(e.target.files?.[0]); e.target.value = ""; }}
            />
            {imageUrl ? (
              <div className="relative rounded-md border border-border overflow-hidden bg-background">
                <img src={imageUrl} alt="Trade screenshot" className="w-full max-h-72 object-contain" />
                <div className="absolute top-2 right-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded bg-background/80 backdrop-blur px-2 py-1 text-[10px] font-medium border border-border hover:bg-accent"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={clearImage}
                    className="rounded bg-background/80 backdrop-blur px-2 py-1 text-[10px] font-medium border border-border text-destructive hover:bg-destructive/10"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-md border border-dashed border-border bg-background/40 px-3 py-6 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition flex flex-col items-center gap-1.5"
              >
                <Upload className="h-4 w-4" />
                <span>Upload screenshot or paste from clipboard</span>
                <span className="text-[10px]">Stored only on your device</span>
              </button>
            )}
          </Field>

          <div className="rounded-lg border border-border bg-card/60 p-4">
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
                    className={`rounded-lg border p-2 text-center transition ${active ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}
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
                className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            )}
          </div>


          <div className="rounded-lg border border-border bg-background/50 p-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">P&amp;L</div>
              <div className={`font-semibold ${previewPnl > 0 ? "text-bull" : previewPnl < 0 ? "text-destructive" : ""}`}>
                {previewPnl >= 0 ? "+" : ""}{previewPnl.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">R:R (actual)</div>
              <div className="font-semibold">{previewRR == null ? "-" : previewRR.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">R:R (planned)</div>
              <div className="font-semibold">{previewPlannedRR == null ? "-" : previewPlannedRR.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t border-border/60">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          <button
            disabled={!canSave}
            onClick={submit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editing ? "Save changes" : "Log trade"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1.5">{label}</div>
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
      <div className="h-12 w-16 rounded border border-border bg-background/40 flex items-center justify-center text-muted-foreground shrink-0">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Trade screenshot"
      className="h-12 w-16 rounded border border-border object-cover shrink-0"
    />
  );
}
