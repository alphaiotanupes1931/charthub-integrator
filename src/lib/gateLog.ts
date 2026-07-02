/**
 * Structured, session-scoped logger for the /_app route gate.
 *
 * Every decision the gate makes (session hydration attempts, profile fetch,
 * subscription lookup, admin bypass, final redirect target) is recorded so
 * you can answer "why did I end up on /pricing instead of /dashboard?" by
 * either reading the browser console or inspecting `window.__trademindGateLog`.
 *
 * The ring buffer is capped at 50 entries per tab and persists in
 * sessionStorage so a hard navigation (window.location.assign) does not lose
 * the trail across the redirect.
 */

export type GateEvent =
  | { step: "start"; pathname: string; href: string }
  | { step: "admin-testing-bypass" }
  | { step: "hydrate-attempt"; attempt: number; hasUser: boolean; error?: string }
  | { step: "hydrated"; userId: string; email: string | null; attempts: number }
  | { step: "hydrate-failed"; attempts: number }
  | { step: "profile"; found: boolean; onboarded?: boolean; banned?: boolean }
  | { step: "profile-created" }
  | { step: "redirect"; to: string; reason: string }
  | { step: "role"; isAdmin: boolean }
  | { step: "subscription"; localStatus: string | null; syncedStatus?: string | null; active: boolean }
  | { step: "allow"; pathname: string };

interface GateLogEntry {
  t: number;
  event: GateEvent;
}

const KEY = "trademind.gateLog";
const MAX = 50;

function read(): GateLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as GateLogEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: GateLogEntry[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX)));
  } catch { /* quota – ignore */ }
}

export function logGate(event: GateEvent) {
  if (typeof window === "undefined") return;
  const entry: GateLogEntry = { t: Date.now(), event };
  const next = [...read(), entry].slice(-MAX);
  write(next);
  // Attach to window for quick DevTools inspection: `window.__trademindGateLog`.
  (window as unknown as { __trademindGateLog?: GateLogEntry[] }).__trademindGateLog = next;
  // Colored console line so you can grep for "[gate]" in the browser console.
  // eslint-disable-next-line no-console
  console.info(
    `%c[gate]%c ${event.step}`,
    "color:#eab308;font-weight:bold",
    "color:inherit",
    event,
  );
}

export function clearGateLog() {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  (window as unknown as { __trademindGateLog?: GateLogEntry[] }).__trademindGateLog = [];
}

export function readGateLog(): GateLogEntry[] {
  return read();
}
