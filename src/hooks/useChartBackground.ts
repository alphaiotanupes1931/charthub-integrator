import { useCallback, useEffect, useState } from "react";

export type ChartBackground = {
  bg: string;
  grid: string;
  text: string;
  border: string;
};

// TradingView-inspired dark default. Users can switch to presets or custom hex.
export const DEFAULT_CHART_BACKGROUND: ChartBackground = {
  bg: "#131722",
  grid: "#1e222d",
  text: "#b2b5be",
  border: "#2a2e39",
};

export const CHART_BG_PRESETS: Record<string, ChartBackground> = {
  "TradingView Dark": DEFAULT_CHART_BACKGROUND,
  Midnight: { bg: "#0b1220", grid: "#141c2e", text: "#a8b0c2", border: "#1f2a44" },
  Charcoal: { bg: "#1a1a1a", grid: "#262626", text: "#c0c0c0", border: "#333333" },
  Slate: { bg: "#1e293b", grid: "#334155", text: "#cbd5e1", border: "#475569" },
  Paper: { bg: "#f7f7f5", grid: "#e5e5e0", text: "#333333", border: "#c9c9c2" },
  White: { bg: "#ffffff", grid: "#eaeaea", text: "#222222", border: "#cccccc" },
};

const STORAGE_KEY = "trademind.chartBackground.v1";
const EVENT = "trademind:chartBackground";

function isHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

function read(): ChartBackground {
  if (typeof window === "undefined") return DEFAULT_CHART_BACKGROUND;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHART_BACKGROUND;
    const parsed = JSON.parse(raw);
    const out: ChartBackground = { ...DEFAULT_CHART_BACKGROUND };
    (Object.keys(out) as (keyof ChartBackground)[]).forEach((k) => {
      if (typeof parsed?.[k] === "string" && isHex(parsed[k])) out[k] = parsed[k];
    });
    return out;
  } catch {
    return DEFAULT_CHART_BACKGROUND;
  }
}

export function useChartBackground() {
  const [colors, setColors] = useState<ChartBackground>(DEFAULT_CHART_BACKGROUND);

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

  const update = useCallback((patch: Partial<ChartBackground>) => {
    const next = { ...read(), ...patch };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* ignore */
    }
    setColors(next);
  }, []);

  const setPreset = useCallback((name: string) => {
    const preset = CHART_BG_PRESETS[name];
    if (!preset) return;
    update(preset);
  }, [update]);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(EVENT));
    } catch {
      /* ignore */
    }
    setColors(DEFAULT_CHART_BACKGROUND);
  }, []);

  return { colors, update, setPreset, reset, isHex };
}
