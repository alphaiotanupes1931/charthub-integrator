import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Volume2, X } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { readActiveCoach, readJournal } from "@/lib/chat-client";
import { voiceForCoach } from "@/lib/coachVoices";
import { getLatestRecapContext } from "@/lib/welcomeBack.functions";

const SESSION_KEY = "trademind.welcomeBack.played.v1";

type JournalTrade = {
  symbol?: string;
  side?: string;
  entry?: number;
  exit?: number;
  notes?: string;
  createdAt?: number;
};

function firstName(name: string | null | undefined, email: string | null | undefined): string {
  const raw = (name?.trim() || email?.split("@")[0] || "").replace(/[._-]+/g, " ").trim();
  if (!raw) return "trader";
  return raw
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

function buildRecap(
  name: string,
  trade: JournalTrade | null,
  lastAssistant: string | null,
  threadTitle: string | null,
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
    parts.push("Your journal is empty so far — log a trade and I'll start grading your edge.");
  }
  if (lastAssistant) {
    parts.push(`Picking up where we left off: ${clip(lastAssistant, 220)}`);
  } else if (threadTitle) {
    parts.push(`Your last thread was "${threadTitle}".`);
  }
  parts.push("Ready when you are.");
  return parts.join(" ");
}

export function WelcomeBackGreeter() {
  const { profile, loading } = useProfile();
  const fetchContext = useServerFn(getLatestRecapContext);
  const [needsTap, setNeedsTap] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (loading || !profile || fired.current) return;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    fired.current = true;

    let cancelled = false;
    let played = false;

    const prepareAudio = async (): Promise<HTMLAudioElement | null> => {
      let recap = "";
      try {
        const ctx = await fetchContext();
        const trades = readJournal() as JournalTrade[];
        const lastTrade = trades.length
          ? [...trades].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]
          : null;
        const name = firstName(profile.display_name, profile.email);
        recap = buildRecap(name, lastTrade, ctx.lastAssistant, ctx.threadTitle);
      } catch {
        const name = firstName(profile.display_name, profile.email);
        recap = `Welcome back, ${name}. Ready to grade your next setup?`;
      }
      if (cancelled || !recap) return null;

      try {
        const voiceId = voiceForCoach(readActiveCoach());
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: recap, voiceId }),
        });
        if (!res.ok) {
          console.warn("[welcomeBack] tts failed", res.status, await res.text().catch(() => ""));
          return null;
        }
        const blob = await res.blob();
        if (cancelled) return null;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audioRef.current = audio;
        return audio;
      } catch (err) {
        console.warn("[welcomeBack] error", err);
        return null;
      }
    };

    const markPlayed = () => {
      played = true;
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
    };

    const tryPlay = async (audio: HTMLAudioElement) => {
      try {
        await audio.play();
        markPlayed();
        if (!cancelled) setNeedsTap(false);
        return true;
      } catch {
        return false;
      }
    };

    const gestureEvents: Array<keyof DocumentEventMap> = ["pointerdown", "keydown", "touchstart"];
    const onGesture = async () => {
      const audio = audioRef.current;
      if (!audio || played) {
        removeGestureListeners();
        return;
      }
      const ok = await tryPlay(audio);
      if (ok) removeGestureListeners();
    };
    const removeGestureListeners = () => {
      gestureEvents.forEach((ev) => document.removeEventListener(ev, onGesture));
    };

    (async () => {
      const audio = await prepareAudio();
      if (!audio || cancelled) return;
      const ok = await tryPlay(audio);
      if (!ok) {
        // Autoplay blocked. Show tap prompt + listen for any user gesture.
        if (!cancelled) setNeedsTap(true);
        gestureEvents.forEach((ev) =>
          document.addEventListener(ev, onGesture, { once: false, passive: true }),
        );
      }
    })();

    return () => {
      cancelled = true;
      removeGestureListeners();
    };
  }, [profile, loading, fetchContext]);

  if (!needsTap || dismissed) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-4 py-2.5 text-sm shadow-2xl backdrop-blur">
      <button
        onClick={async () => {
          try {
            await audioRef.current?.play();
            try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* ignore */ }
            setNeedsTap(false);
          } catch {
            /* ignore */
          }
        }}
        className="flex items-center gap-2 font-semibold text-primary"
      >
        <Volume2 className="h-4 w-4" /> Play your welcome back brief
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
