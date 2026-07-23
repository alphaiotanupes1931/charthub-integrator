import { useCallback, useEffect, useRef, useState } from "react";
import { loadAcademyProgress, saveAcademyProgress } from "@/lib/academy-progress.functions";

const KEY = "trademind.academy.progress.v2";

type QuizScore = { score: number; total: number; at: string };

type State = {
  completed: Record<string, true>;
  lastModule: number | null;
  lastLesson: string | null;
  quizScores: Record<string, QuizScore>;
  tourDone: boolean;
};

const EMPTY: State = {
  completed: {},
  lastModule: null,
  lastLesson: null,
  quizScores: {},
  tourDone: false,
};

function read(): State {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
    // migrate v1
    const legacy = localStorage.getItem("trademind.academy.progress.v1");
    if (legacy) {
      const completed = JSON.parse(legacy);
      const migrated = { ...EMPTY, completed };
      localStorage.setItem(KEY, JSON.stringify(migrated));
      return migrated;
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

  // Local read + backend sync on mount
  useEffect(() => {
    const local = read();
    setState(local);

    // Best-effort backend load; merge and persist
    loadAcademyProgress()
      .then((remote) => {
        if (!remote) return;
        const merged: State = {
          completed: { ...local.completed, ...remote.completed },
          lastModule: remote.last_module ?? local.lastModule,
          lastLesson: remote.last_lesson ?? local.lastLesson,
          quizScores: { ...local.quizScores, ...remote.quiz_scores },
          tourDone: remote.tour_done || local.tourDone,
        };
        setState(merged);
        write(merged);
        hydrated.current = true;
        // If local had extras not in remote, push them back
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
      .catch(() => { hydrated.current = true; /* offline ok */ });

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

  const isDone = useCallback((lessonId: string) => Boolean(state.completed[lessonId]), [state.completed]);

  const markDone = useCallback((lessonId: string) => {
    const cur = read();
    persist({ completed: { ...cur.completed, [lessonId]: true } });
  }, [persist]);

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
  }, [persist]);

  const setTourDone = useCallback((done: boolean) => {
    persist({ tourDone: done });
  }, [persist]);

  const moduleCompletion = useCallback((lessonIds: string[]) => {
    const done = lessonIds.filter((id) => state.completed[id]).length;
    return { done, total: lessonIds.length };
  }, [state.completed]);

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
  };
}
