import { useEffect, useMemo, useState } from "react";
import { HeartPulse, Save, Trash2, BellRing, BellOff } from "lucide-react";

export type MentalEntry = {
  date: string;
  score: 1 | 2 | 3 | 4 | 5;
  sleepHours?: number;
  stress?: 1 | 2 | 3 | 4 | 5;
  mood?: string;
  exercised?: boolean;
  ateWell?: boolean;
  caffeine?: number;
  notes?: string;
  createdAt: number;
};

const STORAGE_KEY = "trademind.mental.v1";
const TRADES_KEY = "trademind.journal.trades.v1";
const REMINDER_KEY = "trademind.mental.reminder.v1";

const pad = (n: number) => String(n).padStart(2, "0");
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function loadMental(): MentalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
export function saveMental(entries: MentalEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* ignore */ }
}
export function upsertMentalEntry(entry: MentalEntry) {
  const all = loadMental();
  const others = all.filter((e) => e.date !== entry.date);
  saveMental([...others, entry]);
}

type Trade = { date: string; entry: number; exit: number; stop: number; size: number; side: "Long" | "Short"; fees?: number; pointValue?: number; reportedPnl?: number };
function loadTrades(): Trade[] {
  try {
    const raw = localStorage.getItem(TRADES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) ?? [];
  } catch { return []; }
}
function tradePnl(t: Trade) {
  if (t.reportedPnl != null && isFinite(t.reportedPnl)) return t.reportedPnl;
  const dir = t.side === "Long" ? 1 : -1;
  const pv = t.pointValue && isFinite(t.pointValue) && t.pointValue > 0 ? t.pointValue : 1;
  const fees = t.fees && isFinite(t.fees) ? t.fees : 0;
  return (t.exit - t.entry) * dir * (t.size || 0) * pv - fees;
}

type Reminder = { enabled: boolean; time: string; lastFired?: string };
function loadReminder(): Reminder {
  try {
    const raw = localStorage.getItem(REMINDER_KEY);
    if (raw) return { enabled: false, time: "18:00", ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { enabled: false, time: "18:00" };
}
function saveReminder(r: Reminder) {
  try { localStorage.setItem(REMINDER_KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

export const SCORE_META: Record<number, { label: string; color: string; hint: string }> = {
  1: { label: "Awful",   color: "text-destructive",   hint: "Rough day. Small size or step away." },
  2: { label: "Rough",   color: "text-amber-500",     hint: "Below your baseline. Trade lighter." },
  3: { label: "Neutral", color: "text-muted-foreground", hint: "Normal day. Trade your plan." },
  4: { label: "Sharp",   color: "text-bull",   hint: "Focused. Trust your setups." },
  5: { label: "Peak",    color: "text-bull",   hint: "Everything clicks. Don't overtrade." },
};

export function MentalStatePanel() {
  const [entries, setEntries] = useState<MentalEntry[]>([]);
  const [score, setScore] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [sleepHours, setSleepHours] = useState("");
  const [stress, setStress] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [mood, setMood] = useState("");
  const [exercised, setExercised] = useState(false);
  const [ateWell, setAteWell] = useState(false);
  const [caffeine, setCaffeine] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const all = loadMental();
    setEntries(all);
    const today = all.find((e) => e.date === todayYmd());
    if (today) {
      setScore(today.score);
      setSleepHours(today.sleepHours != null ? String(today.sleepHours) : "");
      setStress(today.stress ?? null);
      setMood(today.mood ?? "");
      setExercised(!!today.exercised);
      setAteWell(!!today.ateWell);
      setCaffeine(today.caffeine != null ? String(today.caffeine) : "");
      setNotes(today.notes ?? "");
    }
  }, []);

  const [reminder, setReminder] = useState<Reminder>(() => loadReminder());
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported",
  );
  const loggedToday = entries.some((e) => e.date === todayYmd());

  useEffect(() => {
    if (!reminder.enabled) return;
    const id = window.setInterval(() => {
      const now = new Date();
      const [hh, mm] = reminder.time.split(":").map(Number);
      if (isNaN(hh) || isNaN(mm)) return;
      const today = todayYmd();
      const already = loadMental().some((e) => e.date === today);
      if (already) return;
      if (reminder.lastFired === today) return;
      if (now.getHours() === hh && now.getMinutes() === mm) {
        const next = { ...reminder, lastFired: today };
        setReminder(next); saveReminder(next);
        if ("Notification" in window && Notification.permission === "granted") {
          try { new Notification("TradeMind check-in", { body: "Log your mental state score for today." }); } catch { /* ignore */ }
        }
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [reminder]);

  const requestNotif = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotifPermission(p);
  };

  const trades = useMemo(() => loadTrades(), []);
  const pnlByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trades) m.set(t.date, (m.get(t.date) ?? 0) + tradePnl(t));
    return m;
  }, [trades]);

  const rows = useMemo(() =>
    [...entries]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((e) => ({ ...e, pnl: pnlByDay.get(e.date) ?? 0 })),
    [entries, pnlByDay],
  );

  const byScore = useMemo(() => {
    const buckets: Record<number, { n: number; wins: number; pnl: number }> = { 1: { n: 0, wins: 0, pnl: 0 }, 2: { n: 0, wins: 0, pnl: 0 }, 3: { n: 0, wins: 0, pnl: 0 }, 4: { n: 0, wins: 0, pnl: 0 }, 5: { n: 0, wins: 0, pnl: 0 } };
    for (const r of rows) {
      if (!pnlByDay.has(r.date)) continue;
      buckets[r.score].n += 1;
      buckets[r.score].pnl += r.pnl;
      if (r.pnl > 0) buckets[r.score].wins += 1;
    }
    return buckets;
  }, [rows, pnlByDay]);

  const saveToday = () => {
    if (score == null) return;
    const entry: MentalEntry = {
      date: todayYmd(),
      score,
      sleepHours: sleepHours === "" ? undefined : Number(sleepHours),
      stress: stress ?? undefined,
      mood: mood.trim() || undefined,
      exercised: exercised || undefined,
      ateWell: ateWell || undefined,
      caffeine: caffeine === "" ? undefined : Number(caffeine),
      notes: notes.trim() || undefined,
      createdAt: Date.now(),
    };
    const others = entries.filter((e) => e.date !== entry.date);
    const next = [...others, entry];
    setEntries(next);
    saveMental(next);
  };

  const deleteEntry = (date: string) => {
    const next = entries.filter((e) => e.date !== date);
    setEntries(next);
    saveMental(next);
    if (date === todayYmd()) {
      setScore(null); setSleepHours(""); setStress(null); setMood("");
      setExercised(false); setAteWell(false); setCaffeine(""); setNotes("");
    }
  };

  const lowScore = score != null && score <= 2;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm">
            {reminder.enabled ? <BellRing className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
            <span className="font-semibold">Daily check-in reminder</span>
            {loggedToday && <span className="text-[11px] rounded bg-bull/15 text-bull px-1.5 py-0.5">logged today</span>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={reminder.time}
              onChange={(e) => { const n = { ...reminder, time: e.target.value }; setReminder(n); saveReminder(n); }}
              className="rounded-xl border border-border/60 bg-background px-2 py-1 text-xs"
            />
            <button
              onClick={() => {
                const n = { ...reminder, enabled: !reminder.enabled };
                setReminder(n); saveReminder(n);
                if (n.enabled && notifPermission === "default") void requestNotif();
              }}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium border ${reminder.enabled ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
            >
              {reminder.enabled ? "On" : "Off"}
            </button>
          </div>
        </div>
        {reminder.enabled && notifPermission !== "granted" && notifPermission !== "unsupported" && (
          <button onClick={requestNotif} className="mt-2 text-[11px] text-primary underline">
            Enable browser notifications
          </button>
        )}
        {!loggedToday && reminder.enabled && (
          <div className="mt-2 text-[11px] text-muted-foreground">You'll get a nudge at {reminder.time} local time while the app is open.</div>
        )}
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <HeartPulse className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Today, {todayYmd()}</h2>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {([1, 2, 3, 4, 5] as const).map((n) => {
            const meta = SCORE_META[n];
            const active = score === n;
            return (
              <button
                key={n}
                onClick={() => setScore(n)}
                className={`rounded-xl border p-3 text-center transition ${
                  active ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/40"
                }`}
              >
                <div className={`text-2xl font-bold ${meta.color}`}>{n}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{meta.label}</div>
              </button>
            );
          })}
        </div>

        {score != null && (
          <div className="mt-4 text-xs text-muted-foreground italic">{SCORE_META[score].hint}</div>
        )}

        {score != null && (
          <div className="mt-6 space-y-4">
            {lowScore && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-500">
                A low score today, let's dig in a little so patterns show up. What might be off?
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="block">
                <div className="text-[10px] tracking-tight text-muted-foreground mb-1.5">Hours of sleep</div>
                <input
                  inputMode="decimal"
                  value={sleepHours}
                  onChange={(e) => setSleepHours(e.target.value)}
                  placeholder={lowScore ? "how much did you actually get?" : "e.g. 7.5"}
                  className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                />
              </label>
              <div>
                <div className="text-[10px] tracking-tight text-muted-foreground mb-1.5">Stress level</div>
                <div className="grid grid-cols-5 gap-1">
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setStress(n)}
                      className={`rounded border text-xs py-1.5 ${stress === n ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {lowScore && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={exercised} onChange={(e) => setExercised(e.target.checked)} className="h-4 w-4" />
                  <span>Did you exercise / move?</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={ateWell} onChange={(e) => setAteWell(e.target.checked)} className="h-4 w-4" />
                  <span>Ate a real meal before trading?</span>
                </label>
                <label className="block md:col-span-2">
                  <div className="text-[10px] tracking-tight text-muted-foreground mb-1.5">Caffeine (cups)</div>
                  <input
                    inputMode="decimal"
                    value={caffeine}
                    onChange={(e) => setCaffeine(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
                  />
                </label>
              </div>
            )}

            <label className="block">
              <div className="text-[10px] tracking-tight text-muted-foreground mb-1.5">Mood in a word</div>
              <input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                placeholder="focused / anxious / tired / patient..."
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <div className="text-[10px] tracking-tight text-muted-foreground mb-1.5">Notes</div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Anything else going on today?"
                className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm resize-none"
              />
            </label>

            <button
              onClick={saveToday}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Save className="h-4 w-4" /> Save today's log
            </button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card p-6">
          <h2 className="text-sm font-semibold mb-4">Performance by mental state</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Trading P&amp;L broken down by the score you gave yourself that day.
          </p>
          <div className="grid grid-cols-5 gap-2">
            {([1, 2, 3, 4, 5] as const).map((n) => {
              const b = byScore[n];
              const winRate = b.n > 0 ? (b.wins / b.n) * 100 : 0;
              return (
                <div key={n} className="rounded-2xl border border-border/60 p-3 text-center">
                  <div className={`text-lg font-bold ${SCORE_META[n].color}`}>{n}</div>
                  <div className="text-[10px] text-muted-foreground">{SCORE_META[n].label}</div>
                  <div className={`mt-2 text-sm font-semibold ${b.pnl >= 0 ? "text-bull" : "text-destructive"}`}>
                    {b.n === 0 ? "-" : `${b.pnl >= 0 ? "+" : ""}${b.pnl.toFixed(0)}`}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{b.n} days, {b.n > 0 ? `${winRate.toFixed(0)}% win` : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="p-4 border-b border-border/60 text-sm font-semibold">History</div>
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div key={r.date} className="flex items-center gap-4 p-3">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${SCORE_META[r.score].color} bg-background border border-border/60`}>
                  {r.score}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{r.date}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {r.sleepHours != null && `${r.sleepHours}h sleep, `}
                    {r.stress != null && `stress ${r.stress}/5, `}
                    {r.mood && `${r.mood}, `}
                    {r.exercised && "exercised, "}
                    {r.notes}
                  </div>
                </div>
                <div className={`text-sm font-semibold ${r.pnl > 0 ? "text-bull" : r.pnl < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  {pnlByDay.has(r.date) ? `${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(2)}` : "-"}
                </div>
                <button
                  onClick={() => deleteEntry(r.date)}
                  className="h-8 w-8 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
