import { useEffect, useState, useCallback } from "react";

export type CandleColors = {
  up: string;
  down: string;
  wickUp: string;
  wickDown: string;
  borderUp: string;
  borderDown: string;
};

export const DEFAULT_CANDLE_COLORS: CandleColors = {
  up: "#34d399",
  down: "#f87171",
  wickUp: "#34d399",
  wickDown: "#f87171",
  borderUp: "#34d399",
  borderDown: "#f87171",
};

const STORAGE_KEY = "trademind.candleColors.v1";
const EVENT = "trademind:candleColors";

function isHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

function read(): CandleColors {
  if (typeof window === "undefined") return DEFAULT_CANDLE_COLORS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CANDLE_COLORS;
    const parsed = JSON.parse(raw);
    const out: CandleColors = { ...DEFAULT_CANDLE_COLORS };
    (Object.keys(out) as (keyof CandleColors)[]).forEach((k) => {
      if (typeof parsed?.[k] === "string" && isHex(parsed[k])) out[k] = parsed[k];
    });
    return out;
  } catch {
    return DEFAULT_CANDLE_COLORS;
  }
}

export function useCandleColors() {
  const [colors, setColors] = useState<CandleColors>(DEFAULT_CANDLE_COLORS);

  useEffect(() => {
    setColors(read());
    const handler = () => setColors(read());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const update = useCallback((patch: Partial<CandleColors>) => {
    const next = { ...read(), ...patch };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* ignore */
    }
    setColors(next);
  }, []);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* ignore */
    }
    setColors(DEFAULT_CANDLE_COLORS);
  }, []);

  return { colors, update, reset, isHex };
}
