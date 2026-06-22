export const WELCOME_BACK_SESSION_KEY = "trademind.welcomeBack.played.v2";
export const WELCOME_BACK_REQUEST_KEY = "trademind.welcomeBack.requestedAt.v1";

export type JournalTrade = {
  symbol?: string;
  side?: string;
  entry?: number;
  exit?: number;
  notes?: string;
  createdAt?: number;
};

export function spokenName(name: string | null | undefined, email: string | null | undefined): string {
  const raw = (name?.trim() || email?.split("@")[0] || "").replace(/[._-]+/g, " ").trim();
  if (!raw) return "trader";
  return raw
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function latestJournalTrade(trades: JournalTrade[]): JournalTrade | null {
  return trades.length
    ? [...trades].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
    : null;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

export function buildWelcomeBackRecap(
  name: string,
  trade: JournalTrade | null,
  lastAssistant: string | null,
  threadTitle: string | null,
  lastUser?: string | null,
): string {
  const parts: string[] = [`Welcome back, ${name}.`];
  if (trade?.symbol) {
    const side = trade.side ? ` ${trade.side.toLowerCase()}` : "";
    const result =
      typeof trade.entry === "number" && typeof trade.exit === "number"
        ? trade.exit >= trade.entry
          ? trade.side === "Short"
            ? " — closed in the red."
            : " — closed in the green."
          : trade.side === "Short"
            ? " — closed in the green."
            : " — closed in the red."
        : "";
    parts.push(`Last trade in your journal was a${side} on ${trade.symbol}${result}`);
  } else {
    parts.push("Your journal is empty so far. Log a trade and I'll start grading your edge.");
  }
  if (lastUser && lastAssistant) {
    parts.push(`Last time, you brought up: ${clip(lastUser, 120)}. The latest coach recap was: ${clip(lastAssistant, 180)}`);
  } else if (lastAssistant) {
    parts.push(`Picking up where we left off: ${clip(lastAssistant, 220)}`);
  } else if (lastUser) {
    parts.push(`Last thing you brought up was: ${clip(lastUser, 180)}`);
  } else if (threadTitle) {
    parts.push(`Your last thread was "${threadTitle}".`);
  }
  parts.push("Ready when you are.");
  return parts.join(" ");
}

export function configureBrowserVoice(utterance: SpeechSynthesisUtterance, coach: string | undefined | null) {
  utterance.lang = "en-US";
  utterance.rate = 1;
  utterance.pitch = coach === "The Disciplinarian" ? 0.9 : coach === "The Mentor" ? 1.06 : 1;
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const preferred = voices.find((v) => /english|en-/i.test(`${v.lang} ${v.name}`));
  if (preferred) utterance.voice = preferred;
}

export function speakWithBrowserVoice(
  text: string,
  coach: string | undefined | null,
  preparedUtterance?: SpeechSynthesisUtterance | null,
  handlers?: { onStart?: () => void; onEnd?: () => void; onError?: () => void },
): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
  const utterance = preparedUtterance ?? new SpeechSynthesisUtterance();
  utterance.text = text;
  utterance.onstart = handlers?.onStart ?? null;
  utterance.onend = handlers?.onEnd ?? null;
  utterance.onerror = handlers?.onError ?? null;
  configureBrowserVoice(utterance, coach);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}