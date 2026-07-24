import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadAcademyProgress, saveAcademyProgress } from "@/lib/academy-progress.functions";

const KEY = "trademind.academy.progress.v3";
const LEGACY_KEYS = ["trademind.academy.progress.v2", "trademind.academy.progress.v1"];

type QuizScore = { score: number; total: number; at: string };
export type WrongEntry = { moduleId: number; qIndex: number };

type State = {
  completed: Record<string, true>;
  lastModule: number | null;
  lastLesson: string | null;
  quizScores: Record<string, QuizScore>;
  tourDone: boolean;
  studyDays: string[]; // ISO YYYY-MM-DD in local time, ascending, unique
  wrongBank: WrongEntry[]; // deduped queue of missed quiz questions
  finalExam: QuizScore | null;
};

const EMPTY: State = {
  completed: {},
  lastModule: null,
  lastLesson: null,
  quizScores: {},
  tourDone: false,
  studyDays: [],
  wrongBank: [],
  finalExam: null,
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO + "T00:00:00").getTime();
  const b = new Date(bISO + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

function computeStreaks(days: string[]): { current: number; longest: number } {
  if (days.length === 0) return { current: 0, longest: 0 };
  const sorted = [...new Set(days)].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (daysBetween(sorted[i - 1], sorted[i]) === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  const today = todayISO();
  const last = sorted[sorted.length - 1];
  const gap = daysBetween(last, today);
  let current = 0;
  if (gap <= 1) {
    // walk back from the latest day counting consecutive days
    current = 1;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (daysBetween(sorted[i], sorted[i + 1]) === 1) current += 1;
      else break;
    }
  }
  return { current, longest };
}

function read(): State {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
    for (const legacy of LEGACY_KEYS) {
      const val = localStorage.getItem(legacy);
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        // v1 was just a completed map; v2 was full state
        const migrated: State = {
          ...EMPTY,
          ...(typeof parsed === "object" && parsed !== null && "completed" in parsed
            ? parsed
            : { completed: parsed as Record<string, true> }),
        };
        localStorage.setItem(KEY, JSON.stringify(migrated));
        return migrated;
      } catch { /* try next */ }
    }
  } catch { /* noop */ }
  return EMPTY;
}

function write(s: State) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("academy-progress"));
}

export function useAcademyProgress() {
  const [state, setState] = useState<State>(EMPTY);
  const hydrated = useRef(false);

  useEffect(() => {
    const local = read();
    setState(local);

    loadAcademyProgress()
      .then((remote) => {
        if (!remote) return;
        const merged: State = {
          completed: { ...local.completed, ...remote.completed },
          lastModule: remote.last_module ?? local.lastModule,
          lastLesson: remote.last_lesson ?? local.lastLesson,
          quizScores: { ...local.quizScores, ...remote.quiz_scores },
          tourDone: remote.tour_done || local.tourDone,
          studyDays: local.studyDays,
          wrongBank: local.wrongBank,
          finalExam: local.finalExam,
        };
        setState(merged);
        write(merged);
        hydrated.current = true;
        const needsPush =
          Object.keys(local.completed).some((k) => !remote.completed?.[k]) ||
          (local.lastLesson && !remote.last_lesson) ||
          (local.tourDone && !remote.tour_done);
        if (needsPush) {
          saveAcademyProgress({
            data: {
              completed: merged.completed,
              last_module: merged.lastModule,
              last_lesson: merged.lastLesson,
              quiz_scores: merged.quizScores,
              tour_done: merged.tourDone,
            },
          }).catch(() => { /* offline ok */ });
        }
      })
      .catch(() => { hydrated.current = true; });

    const onChange = () => setState(read());
    window.addEventListener("academy-progress", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("academy-progress", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const persist = useCallback((patch: Partial<State>) => {
    const next = { ...read(), ...patch };
    write(next);
    setState(next);
    // Only send server-known fields; studyDays / wrongBank stay local.
    saveAcademyProgress({
      data: {
        completed: next.completed,
        last_module: next.lastModule,
        last_lesson: next.lastLesson,
        quiz_scores: next.quizScores,
        tour_done: next.tourDone,
      },
    }).catch(() => { /* offline ok */ });
  }, []);

  const markStudiedToday = useCallback(() => {
    const cur = read();
    const t = todayISO();
    if (cur.studyDays.includes(t)) return;
    const next = { ...cur, studyDays: [...cur.studyDays, t].sort() };
    write(next);
    setState(next);
  }, []);

  const isDone = useCallback((lessonId: string) => Boolean(state.completed[lessonId]), [state.completed]);

  const markDone = useCallback((lessonId: string) => {
    const cur = read();
    persist({ completed: { ...cur.completed, [lessonId]: true } });
    markStudiedToday();
  }, [persist, markStudiedToday]);

  const clear = useCallback((lessonId: string) => {
    const cur = read();
    const completed = { ...cur.completed };
    delete completed[lessonId];
    persist({ completed });
  }, [persist]);

  const setLastViewed = useCallback((moduleId: number, lessonId: string) => {
    const cur = read();
    if (cur.lastModule === moduleId && cur.lastLesson === lessonId) return;
    persist({ lastModule: moduleId, lastLesson: lessonId });
  }, [persist]);

  const recordQuiz = useCallback((moduleId: number, score: number, total: number) => {
    const cur = read();
    persist({
      quizScores: {
        ...cur.quizScores,
        [String(moduleId)]: { score, total, at: new Date().toISOString() },
      },
    });
    markStudiedToday();
  }, [persist, markStudiedToday]);

  const setTourDone = useCallback((done: boolean) => {
    persist({ tourDone: done });
  }, [persist]);

  const moduleCompletion = useCallback((lessonIds: string[]) => {
    const done = lessonIds.filter((id) => state.completed[id]).length;
    return { done, total: lessonIds.length };
  }, [state.completed]);

  const addWrong = useCallback((moduleId: number, qIndex: number) => {
    const cur = read();
    if (cur.wrongBank.some((e) => e.moduleId === moduleId && e.qIndex === qIndex)) return;
    const next = { ...cur, wrongBank: [...cur.wrongBank, { moduleId, qIndex }] };
    write(next);
    setState(next);
  }, []);

  const removeWrong = useCallback((moduleId: number, qIndex: number) => {
    const cur = read();
    const wrongBank = cur.wrongBank.filter((e) => !(e.moduleId === moduleId && e.qIndex === qIndex));
    if (wrongBank.length === cur.wrongBank.length) return;
    const next = { ...cur, wrongBank };
    write(next);
    setState(next);
  }, []);

  const recordFinalExam = useCallback((score: number, total: number) => {
    const cur = read();
    const prior = cur.finalExam;
    const next: QuizScore = { score, total, at: new Date().toISOString() };
    // Keep best attempt
    const keep = !prior || score / total >= prior.score / prior.total ? next : prior;
    const merged = { ...cur, finalExam: keep };
    write(merged);
    setState(merged);
  }, []);

  const streaks = useMemo(() => computeStreaks(state.studyDays), [state.studyDays]);
  const studiedToday = useMemo(() => state.studyDays.includes(todayISO()), [state.studyDays]);

  return {
    isDone,
    markDone,
    clear,
    moduleCompletion,
    lastModule: state.lastModule,
    lastLesson: state.lastLesson,
    quizScores: state.quizScores,
    tourDone: state.tourDone,
    setLastViewed,
    recordQuiz,
    setTourDone,
    // Phase 11
    wrongBank: state.wrongBank,
    addWrong,
    removeWrong,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    studiedToday,
    markStudiedToday,
    finalExam: state.finalExam,
    recordFinalExam,
  };
}
