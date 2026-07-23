import { useCallback, useEffect, useState } from "react";

const KEY = "trademind.academy.progress.v1";

type Progress = Record<string, true>;

function read(): Progress {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}

function write(p: Progress) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new CustomEvent("academy-progress"));
}

export function useAcademyProgress() {
  const [progress, setProgress] = useState<Progress>({});

  useEffect(() => {
    setProgress(read());
    const onChange = () => setProgress(read());
    window.addEventListener("academy-progress", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("academy-progress", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const isDone = useCallback((lessonId: string) => Boolean(progress[lessonId]), [progress]);

  const markDone = useCallback((lessonId: string) => {
    const next = { ...read(), [lessonId]: true as const };
    write(next);
    setProgress(next);
  }, []);

  const clear = useCallback((lessonId: string) => {
    const next = { ...read() };
    delete next[lessonId];
    write(next);
    setProgress(next);
  }, []);

  const moduleCompletion = useCallback((lessonIds: string[]) => {
    const done = lessonIds.filter((id) => progress[id]).length;
    return { done, total: lessonIds.length };
  }, [progress]);

  return { isDone, markDone, clear, moduleCompletion };
}
