export const WELCOME_BACK_SESSION_KEY = "trademind.welcomeBack.played.v2";
export const WELCOME_BACK_REQUEST_KEY = "trademind.welcomeBack.requestedAt.v1";
export const WELCOME_BACK_MUTED_KEY = "trademind.welcomeBack.muted.v1";

export function isWelcomeBackMuted(): boolean {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(WELCOME_BACK_MUTED_KEY) === "1"; } catch { return false; }
}
export function setWelcomeBackMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(WELCOME_BACK_MUTED_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
}

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
            ? " - closed in the red."
            : " - closed in the green."
          : trade.side === "Short"
            ? " - closed in the green."
            : " - closed in the red."
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

export function coachToElevenVoiceId(coach: string | null | undefined): string {
  switch (coach) {
    case "The Disciplinarian":
    case "The Beast":
      return "bIHbv24MWmeRgasZH58o"; // Will
    case "The Mentor":
      return "XrExE9yKIg1WjnnlVkGX"; // Matilda
    case "The Analyst":
    case "The Sniper":
    case "The Monk":
    default:
      return "JBFqnCBsd6RMkjVDRZzb"; // George
  }
}

// Plays the welcome-back recap using ElevenLabs (via /api/tts).
// Pass `audio` from a user-gesture context (auth submit) so autoplay rules
// allow .play() after navigation.
export async function speakWithElevenLabs(
  text: string,
  coach: string | null | undefined,
  audio?: HTMLAudioElement | null,
  handlers?: { onStart?: () => void; onEnd?: () => void; onError?: () => void },
): Promise<boolean> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId: coachToElevenVoiceId(coach) }),
    });
    if (!res.ok) throw new Error(`tts ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const el = audio ?? new Audio();
    el.src = url;
    el.onplay = () => handlers?.onStart?.();
    el.onended = () => {
      handlers?.onEnd?.();
      URL.revokeObjectURL(url);
    };
    el.onerror = () => handlers?.onError?.();
    await el.play();
    return true;
  } catch (err) {
    console.warn("[welcomeBack] elevenlabs failed", err);
    handlers?.onError?.();
    return false;
  }
}