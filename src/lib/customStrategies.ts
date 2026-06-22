import { STRATEGIES, type Level, type Style, type Strategy } from "@/data/strategies";

const CUSTOM_KEY = "trademind.customStrategies.v1";

export type CustomStrategy = Strategy & {
  custom: true;
  id: string;
  rules?: string;
  createdAt: number;
};

export function readCustomStrategies(): CustomStrategy[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function writeCustomStrategies(list: CustomStrategy[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function saveCustomStrategy(s: Omit<CustomStrategy, "custom" | "id" | "createdAt"> & { id?: string }): CustomStrategy {
  const list = readCustomStrategies();
  const id = s.id ?? `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const next: CustomStrategy = { ...s, custom: true, id, createdAt: Date.now() };
  const idx = list.findIndex((c) => c.id === id);
  if (idx >= 0) list[idx] = next; else list.unshift(next);
  writeCustomStrategies(list);
  return next;
}

export function deleteCustomStrategy(id: string) {
  writeCustomStrategies(readCustomStrategies().filter((c) => c.id !== id));
}

export function allStrategies(): (Strategy | CustomStrategy)[] {
  return [...readCustomStrategies(), ...STRATEGIES];
}

export function findStrategyByName(name: string): Strategy | CustomStrategy | null {
  return readCustomStrategies().find((c) => c.name === name)
    ?? STRATEGIES.find((s) => s.name === name)
    ?? null;
}

export const LEVELS: Level[] = ["Beginner", "Intermediate", "Advanced"];
export const STYLES: Style[] = ["Day", "Swing", "Scalp"];
export const MARKETS = ["Forex", "Stocks", "Crypto", "Futures", "Options", "Commodities"];
