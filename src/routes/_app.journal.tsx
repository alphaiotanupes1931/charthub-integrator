import { createFileRoute } from "@tanstack/react-router";
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
} from "lucide-react";
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

type Trade = {
  id: string;
  date: string;       // local YYYY-MM-DD, never UTC-shifted
  timeframe: Timeframe;
  symbol: string;
  side: Side;
  entry: number;
  exit: number;
  stop: number;
  size: number;
  notes: string;
  hasImage?: boolean; // screenshot stored locally in IndexedDB
  createdAt: number;
};

const STORAGE_KEY = "trademind.journal.trades.v1";

// --- Local-date helpers (NEVER use toISOString — it shifts to UTC) ---
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

// --- P&L and R:R ---
function tradePnl(t: Trade): number {
  const dir = t.side === "Long" ? 1 : -1;
  return (t.exit - t.entry) * dir * (t.size || 1);
}
function tradeRR(t: Trade): number | null {
  const risk = Math.abs(t.entry - t.stop);
  if (!risk || !isFinite(risk)) return null;
  const dir = t.side === "Long" ? 1 : -1;
  const reward = (t.exit - t.entry) * dir;
  return reward / risk;
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

function JournalPage() {
  const [tab, setTab] = useState<"calendar" | "trades">("calendar");
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<string>(todayYmd());
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { setTrades(loadTrades()); }, []);
  useEffect(() => { saveTrades(trades); }, [trades]);

  // Hand-off from Broker → Journal "Snapshot to Journal".
  const [prefill, setPrefill] = useState<{ symbol?: string; timeframe?: string; notes?: string } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("trademind.journal.prefill.v1");
      if (!raw) return;
      const data = JSON.parse(raw);
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

  // Aggregate by day for the calendar
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

  const openNew = (date: string) => {
    setEditingId(null);
    setFormDate(date);
    setFormOpen(true);
  };
  const openEdit = (t: Trade) => {
    setEditingId(t.id);
    setFormDate(t.date);
    setFormOpen(true);
  };

  const handleSave = (t: Trade) => {
    setTrades((prev) => {
      const exists = prev.some((p) => p.id === t.id);
      return exists ? prev.map((p) => (p.id === t.id ? t : p)) : [t, ...prev];
    });
    setFormOpen(false);
    setEditingId(null);
  };
  const handleDelete = (id: string) => {
    setTrades((prev) => prev.filter((p) => p.id !== id));
    void deleteTradeImage(id);
  };

  const editing = editingId ? trades.find((t) => t.id === editingId) ?? null : null;

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Trade Journal"
        description={
          <>
            Log every trade with its date, timeframe, and execution data. Entries save to the exact
            day you pick — no second-guessing. R:R, P&amp;L, and grades are computed from your inputs.
          </>
        }
      />

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex gap-2">
          {[
            { id: "calendar", label: "Calendar", icon: CalIcon },
            { id: "trades", label: "Trades", icon: BookOpen },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id as typeof tab)}
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
                      <div className={`text-[10px] sm:text-xs font-semibold ${positive ? "text-emerald-400" : negative ? "text-destructive" : "text-muted-foreground"}`}>
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
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {sortedTrades.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No trades logged yet. Hit <span className="text-foreground font-medium">Log trade</span> to add one.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {sortedTrades.map((t) => {
                const pnl = tradePnl(t);
                const rr = tradeRR(t);
                return (
                  <div key={t.id} className="flex items-center gap-4 p-4 hover:bg-accent/20 transition">
                    {t.hasImage && <TradeThumb tradeId={t.id} />}
                    <button onClick={() => openEdit(t)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{t.symbol}</span>
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          t.side === "Long" ? "bg-emerald-500/15 text-emerald-400" : "bg-destructive/15 text-destructive"
                        }`}>
                          {t.side === "Long" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {t.side}
                        </span>
                        <span className="text-[11px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1.5 py-0.5">
                          {t.timeframe}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatYmdHuman(t.date)}</span>
                        {t.hasImage && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Screenshot stored on this device only">
                            <ImageIcon className="h-3 w-3" /> local
                          </span>
                        )}
                      </div>
                      {t.notes && <div className="mt-1 text-xs text-muted-foreground line-clamp-1">{t.notes}</div>}
                    </button>
                    <div className="text-right shrink-0">
                      <div className={`font-semibold ${pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-destructive" : ""}`}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        R:R {rr == null ? "—" : `${rr.toFixed(2)}`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
                      aria-label="Delete trade"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
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

function TradeFormModal({
  initialDate,
  editing,
  prefill,
  onClose,
  onSave,
}: {
  initialDate: string;
  editing: Trade | null;
  prefill?: { symbol?: string; timeframe?: string; notes?: string } | null;
  onClose: () => void;
  onSave: (t: Trade) => void;
}) {
  const [date, setDate] = useState(editing?.date ?? initialDate);
  const [timeframe, setTimeframe] = useState<Timeframe>(
    editing?.timeframe ?? (TIMEFRAMES.includes((prefill?.timeframe ?? "") as Timeframe) ? (prefill!.timeframe as Timeframe) : "1H"),
  );
  const [symbol, setSymbol] = useState(editing?.symbol ?? prefill?.symbol ?? "XAU/USD");
  const [side, setSide] = useState<Side>(editing?.side ?? "Long");
  const [entry, setEntry] = useState<string>(editing ? String(editing.entry) : "");
  const [exit, setExit] = useState<string>(editing ? String(editing.exit) : "");
  const [stop, setStop] = useState<string>(editing ? String(editing.stop) : "");
  const [size, setSize] = useState<string>(editing ? String(editing.size) : "1");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  // Load existing image preview when editing.
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

  // Paste-from-clipboard support (great for TradingView screenshots).
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

  const preview: Trade = {
    id: editing?.id ?? "preview",
    date,
    timeframe,
    symbol,
    side,
    entry: Number(entry) || 0,
    exit: Number(exit) || 0,
    stop: Number(stop) || 0,
    size: Number(size) || 0,
    notes,
    hasImage,
    createdAt: editing?.createdAt ?? Date.now(),
  };
  const previewPnl = tradePnl(preview);
  const previewRR = tradeRR(preview);

  const canSave = symbol.trim() && entry !== "" && exit !== "" && stop !== "" && date;

  const submit = async () => {
    if (!canSave) return;
    const id = editing?.id ?? `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    if (pendingImage) {
      await putTradeImage(id, pendingImage);
    } else if (removeImage && editing?.hasImage) {
      await deleteTradeImage(id);
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
                        ? s === "Long" ? "bg-emerald-500/15 text-emerald-400" : "bg-destructive/15 text-destructive"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Entry">
              <input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Stop">
              <input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Exit">
              <input inputMode="decimal" value={exit} onChange={(e) => setExit(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </Field>
          </div>

          <Field label="Size (units / contracts)">
            <input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </Field>

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
                <span className="text-[10px]">Stored only on your device — never uploaded to our servers</span>
              </button>
            )}
          </Field>

          <div className="rounded-lg border border-border bg-background/50 p-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">P&amp;L</div>
              <div className={`font-semibold ${previewPnl > 0 ? "text-emerald-400" : previewPnl < 0 ? "text-destructive" : ""}`}>
                {previewPnl >= 0 ? "+" : ""}{previewPnl.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">R:R</div>
              <div className="font-semibold">{previewRR == null ? "—" : previewRR.toFixed(2)}</div>
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
