import type { Answers } from "./config";
import type { Recommendation } from "./score";

export const DRAFT_KEY = "tm_profile_draft";
export const WEEK_KEY = "trademind.trader-week.v1";

export type Draft = {
  answers: Answers;
  source: "public_quiz" | "onboarding" | "self_select";
  code?: string | null;
  ref?: string | null;
  utm?: Record<string, string>;
};

export function readDraft(): Draft | null {
  try { const raw = localStorage.getItem(DRAFT_KEY); return raw ? (JSON.parse(raw) as Draft) : null; } catch { return null; }
}
export function writeDraft(d: Draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}
export function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

const ATTR_KEY = "tm_attribution";
/** Captures ?ref, utm_* and ?answers (a quiz code) from the URL so they survive signup. */
export function captureAttribution() {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  const cur = readAttribution();
  const utm: Record<string, string> = { ...cur.utm };
  p.forEach((v, k) => { if (k.startsWith("utm_")) utm[k] = v.slice(0, 200); });
  const next = { ref: p.get("ref")?.slice(0, 64) ?? cur.ref ?? null, utm, code: p.get("answers") ?? cur.code ?? null };
  try { localStorage.setItem(ATTR_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}
export function readAttribution(): { ref: string | null; utm: Record<string, string>; code: string | null } {
  try {
    const raw = localStorage.getItem(ATTR_KEY);
    if (raw) return { ref: null, utm: {}, code: null, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ref: null, utm: {}, code: null };
}
export function clearAttributionCode() {
  const a = readAttribution();
  try { localStorage.setItem(ATTR_KEY, JSON.stringify({ ...a, code: null })); } catch { /* ignore */ }
}

export type SavedWeek = { type: string; startedAt: string; tasks: Recommendation["week"]; done: Record<number, boolean> };
export function readWeek(): SavedWeek | null {
  try { const raw = localStorage.getItem(WEEK_KEY); return raw ? (JSON.parse(raw) as SavedWeek) : null; } catch { return null; }
}
export function writeWeek(w: SavedWeek) {
  try { localStorage.setItem(WEEK_KEY, JSON.stringify(w)); } catch { /* ignore */ }
}
