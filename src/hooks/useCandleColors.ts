import { useEffect, useState, useCallback } from "react";

export type CandleColors = {
  up: string;
  down: string;
  wickUp: string;
  wickDown: string;
  borderUp: string;
  borderDown: string;
};

// TradingView-style defaults (teal/red) so the setup view matches the live
// trading view look out of the box. Users can still override in Settings.
export const DEFAULT_CANDLE_COLORS: CandleColors = {
  up: "#26a69a",
  down: "#ef5350",
  wickUp: "#26a69a",
  wickDown: "#ef5350",
  borderUp: "#26a69a",
  borderDown: "#ef5350",
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
