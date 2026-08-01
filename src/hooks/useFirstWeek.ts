import { useCallback, useEffect, useMemo, useState } from "react";

const KEY = "trademind.first-week.v1";

export type FirstWeekTask = {
  id: string;
  label: string;
  description: string;
  cta: string;
  route: string;
  day: number; // 1-7
  // How completion is detected
  kind: "event" | "manual";
  event?: string;
};

export const FIRST_WEEK_TASKS: FirstWeekTask[] = [
  {
    id: "tour",
    label: "Finish the welcome tour",
    description: "A 60-second walkthrough of the dashboard, chat, journal, and testing mode.",
    cta: "Start tour",
    route: "/dashboard",
    day: 1,
    kind: "event",
    event: "tour-done",
  },
  {
    id: "timezone",
    label: "Set your timezone",
    description: "Make sure chart times and session badges match your local trading day.",
    cta: "Open settings",
    route: "/settings",
    day: 1,
    kind: "event",
    event: "timezone-set",
  },
  {
    id: "scan",
    label: "Run your first scan",
    description: "Pick an instrument and hit Run Scan to get a graded setup with entry, stop, and targets.",
    cta: "Run scan",
    route: "/dashboard",
    day: 1,
    kind: "event",
    event: "scan-run",
  },
  {
    id: "academy",
    label: "Complete one Academy lesson",
    description: "Start with Module 1: Reading the chart. Each lesson is a short, self-contained card.",
    cta: "Open Academy",
    route: "/academy",
    day: 2,
    kind: "event",
    event: "academy-lesson",
  },
  {
    id: "flashcards",
    label: "Study 5 flashcards",
    description: "Flip through the Trading Basics or Using TradeMind deck to lock in the fundamentals.",
    cta: "Open flashcards",
    route: "/flashcards",
    day: 2,
    kind: "event",
    event: "flashcards-5",
  },
  {
    id: "discord",
    label: "Join the TradeMind Community",
    description: "Get live A/A+ signals, daily briefings, and ask questions alongside other traders.",
    cta: "Join Discord",
    route: "/discord",
    day: 3,
    kind: "event",
    event: "discord-joined",
  },
  {
    id: "testing",
    label: "Try a paper trade",
    description: "Turn on Testing mode and place a fake trade with $10,000 practice money.",
    cta: "Open testing",
    route: "/testing",
    day: 3,
    kind: "event",
    event: "paper-trade",
  },
  {
    id: "journal",
    label: "Log a trade in your journal",
    description: "Record entry, exit, and your mental state. Auto-fill from any scan you have already run.",
    cta: "Open journal",
    route: "/journal",
    day: 4,
    kind: "event",
    event: "journal-log",
  },
  {
    id: "quiz",
    label: "Pass a module quiz",
    description: "Test what you have learned. You need 2 out of 3 to pass and earn a module certificate.",
    cta: "Take a quiz",
    route: "/academy",
    day: 4,
    kind: "event",
    event: "quiz-pass",
  },
  {
    id: "risk-calculator",
    label: "Size a trade with the calculator",
    description: "Enter your account, risk %, entry and stop to see the exact lot or contract size.",
    cta: "Open calculator",
    route: "/calculator",
    day: 5,
    kind: "event",
    event: "calculator-used",
  },
  {
    id: "briefings",
    label: "Join the community Discord",
    description: "Daily briefings and every A/A+ signal get posted there automatically.",
    cta: "Open community",
    route: "/discord",
    day: 5,
    kind: "event",
    event: "discord-joined",
  },
  {
    id: "review",
    label: "Review a missed quiz question",
    description: "Clear one item from your wrong-answer bank to reinforce what you have learned.",
    cta: "Review queue",
    route: "/academy/review",
    day: 6,
    kind: "event",
    event: "review-cleared",
  },
  {
    id: "final-exam",
    label: "Take the final exam",
    description: "Pass the 36-question comprehensive exam with 80% to earn your master certificate.",
    cta: "Take final exam",
    route: "/academy/exam",
    day: 7,
    kind: "event",
    event: "final-exam",
  },
];

type State = {
  startedAt: string | null; // ISO date
  completed: Record<string, true>;
  dismissed: boolean;
  flashcardCount: number;
  // day-by-day tracking for streaks
  lastDay: number;
};

const EMPTY: State = {
  startedAt: null,
  completed: {},
  dismissed: false,
  flashcardCount: 0,
  lastDay: 0,
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayDiff(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00").getTime();
  const b = new Date(bISO + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

function read(): State {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch { /* noop */ }
  return EMPTY;
}

function write(s: State) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("trademind:first-week"));
  } catch { /* noop */ }
}

export function startFirstWeek() {
  const s = read();
  if (s.startedAt) return;
  write({ ...s, startedAt: todayISO() });
}

export function emitFirstWeekEvent(event: string, value?: number) {
  if (typeof window === "undefined") return;
  // Persist immediately so completion is recorded even when the First Week
  // panel isn't mounted (which is where the listener otherwise lives).
  markFirstWeekEvent(event, value);
  window.dispatchEvent(new CustomEvent("trademind:first-week-event", { detail: { event, value } }));
}

export function markFirstWeekTask(id: string) {
  const s = read();
  if (s.completed[id]) return;
  const completed: Record<string, true> = { ...s.completed, [id]: true };
  write({ ...s, completed });
}

export function markFirstWeekEvent(event: string, value?: number) {
  const s = read();
  const completed: Record<string, true> = { ...s.completed };

  if (event === "tour-done") completed.tour = true;
  if (event === "timezone-set") completed.timezone = true;
  if (event === "scan-run") completed.scan = true;
  if (event === "academy-lesson") completed.academy = true;
  if (event === "discord-joined") completed.discord = true;
  if (event === "paper-trade") completed.testing = true;
  if (event === "journal-log") completed.journal = true;
  if (event === "quiz-pass") completed.quiz = true;
  if (event === "calculator-used") completed["risk-calculator"] = true;
  if (event === "briefings-set") completed.briefings = true;
  if (event === "review-cleared") completed.review = true;
  if (event === "final-exam") completed["final-exam"] = true;

  if (event === "flashcards-5") {
    const nextCount = (s.flashcardCount || 0) + (value ?? 1);
    if (nextCount >= 5) completed.flashcards = true;
    write({ ...s, completed, flashcardCount: nextCount });
    return;
  }

  write({ ...s, completed });
}

export function dismissFirstWeek() {
  const s = read();
  write({ ...s, dismissed: true });
}

export function useFirstWeek() {
  const [state, setState] = useState<State>(EMPTY);

  useEffect(() => {
    setState(read());
    const onChange = () => setState(read());
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.event === "string") {
        // emitFirstWeekEvent already persisted; just refresh local state.
        setState(read());
      }
    };
    window.addEventListener("trademind:first-week", onChange);
    window.addEventListener("trademind:first-week-event", onEvent);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("trademind:first-week", onChange);
      window.removeEventListener("trademind:first-week-event", onEvent);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const start = useCallback(() => {
    startFirstWeek();
    setState(read());
  }, []);

  const mark = useCallback((id: string) => {
    markFirstWeekTask(id);
    setState(read());
  }, []);

  const markEvent = useCallback((event: string, value?: number) => {
    markFirstWeekEvent(event, value);
    setState(read());
  }, []);

  const dismiss = useCallback(() => {
    dismissFirstWeek();
    setState(read());
  }, []);

  const active = useMemo(() => {
    if (!state.startedAt || state.dismissed) return false;
    const day = Math.min(7, Math.max(1, dayDiff(state.startedAt, todayISO()) + 1));
    return day <= 7;
  }, [state.startedAt, state.dismissed]);

  const currentDay = useMemo(() => {
    if (!state.startedAt) return 0;
    return Math.min(7, Math.max(1, dayDiff(state.startedAt, todayISO()) + 1));
  }, [state.startedAt]);

  const completedCount = useMemo(() => FIRST_WEEK_TASKS.filter((t) => state.completed[t.id]).length, [state.completed]);

  const remaining = useMemo(() => {
    return FIRST_WEEK_TASKS.filter((t) => !state.completed[t.id]);
  }, [state.completed]);

  const nextTask = useMemo(() => {
    return remaining.find((t) => t.day <= currentDay) ?? remaining[0] ?? null;
  }, [remaining, currentDay]);

  const upcoming = useMemo(() => {
    const done = new Set(Object.keys(state.completed));
    return FIRST_WEEK_TASKS.filter((t) => t.id !== nextTask?.id && !done.has(t.id) && t.day <= currentDay + 1).slice(0, 3);
  }, [state.completed, currentDay, nextTask]);

  return {
    active,
    currentDay,
    completedCount,
    completed: state.completed,
    total: FIRST_WEEK_TASKS.length,
    progressPct: Math.round((completedCount / FIRST_WEEK_TASKS.length) * 100),
    nextTask,
    upcoming,
    remaining,
    dismissed: state.dismissed,
    startedAt: state.startedAt,
    start,
    mark,
    markEvent,
    dismiss,
  };
}
