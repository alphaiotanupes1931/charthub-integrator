import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Volume2, X } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { readActiveCoach, readJournal } from "@/lib/chat-client";
import { getLatestRecapContext } from "@/lib/welcomeBack.functions";
import {
  buildWelcomeBackRecap,
  latestJournalTrade,
  speakWithBrowserVoice,
  spokenName,
  WELCOME_BACK_REQUEST_KEY,
  WELCOME_BACK_SESSION_KEY,
  type JournalTrade,
} from "@/lib/welcomeBack";

type PreparedWindow = Window & { __trademindWelcomeUtterance?: SpeechSynthesisUtterance };

function shouldPlayWelcome(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(WELCOME_BACK_SESSION_KEY)) return false;
    const requestedAt = Number(localStorage.getItem(WELCOME_BACK_REQUEST_KEY) ?? "0");
    if (!requestedAt) return true;
    return Date.now() - requestedAt < 2 * 60 * 1000;
  } catch {
    return true;
  }
}

function markPlayed() {
  try {
    sessionStorage.setItem(WELCOME_BACK_SESSION_KEY, "1");
    localStorage.removeItem(WELCOME_BACK_REQUEST_KEY);
  } catch {
    /* ignore */
  }
}

export function WelcomeBackGreeter() {
  const { profile } = useProfile();
  const fetchContext = useServerFn(getLatestRecapContext);
  const [needsTap, setNeedsTap] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const recapRef = useRef<string>("");
  const runIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !shouldPlayWelcome()) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    let cancelled = false;
    const coach = readActiveCoach();
    const prepared = (window as PreparedWindow).__trademindWelcomeUtterance ?? null;
    delete (window as PreparedWindow).__trademindWelcomeUtterance;

    const play = (text: string, userInitiated = false) => {
      recapRef.current = text;
      let started = false;
      const ok = speakWithBrowserVoice(text, coach, userInitiated ? null : prepared, {
        onStart: () => {
          started = true;
          markPlayed();
          if (!cancelled) setNeedsTap(false);
        },
        onEnd: markPlayed,
        onError: () => {
          if (!cancelled) setNeedsTap(true);
        },
      });
      if (ok && userInitiated) {
        markPlayed();
        if (!cancelled) setNeedsTap(false);
      } else if (ok) {
        window.setTimeout(() => {
          if (!started && !cancelled) setNeedsTap(true);
        }, 900);
      }
      return ok;
    };

    const gestureEvents: Array<keyof DocumentEventMap> = ["pointerdown", "keydown", "touchstart"];
    const onGesture = () => {
      if (!recapRef.current) return;
      if (play(recapRef.current, true)) removeGestureListeners();
    };
    const removeGestureListeners = () => {
      gestureEvents.forEach((ev) => document.removeEventListener(ev, onGesture));
    };

    (async () => {
      let text = "";
      try {
        const ctx = await Promise.race([
          fetchContext(),
          new Promise<{ displayName: null; email: null; lastAssistant: null; lastUser: null; threadTitle: null }>((resolve) =>
            window.setTimeout(
              () => resolve({ displayName: null, email: null, lastAssistant: null, lastUser: null, threadTitle: null }),
              1800,
            ),
          ),
        ]);
        const trades = readJournal() as JournalTrade[];
        const name = spokenName(ctx.displayName ?? profile?.display_name, ctx.email ?? profile?.email);
        text = buildWelcomeBackRecap(
          name,
          latestJournalTrade(trades),
          ctx.lastAssistant,
          ctx.threadTitle,
          ctx.lastUser,
        );
      } catch (err) {
        console.warn("[welcomeBack] recap failed", err);
        const name = spokenName(profile?.display_name, profile?.email);
        text = `Welcome back, ${name}. I could not load your full recap yet, but I am ready to review your latest setup and journal notes.`;
      }
      if (cancelled || runId !== runIdRef.current || !text) return;

      const ok = play(text);
      if (!ok && !cancelled) {
        setNeedsTap(true);
        gestureEvents.forEach((ev) => document.addEventListener(ev, onGesture, { passive: true }));
      }
    })();

    return () => {
      cancelled = true;
      removeGestureListeners();
    };
  }, [profile?.id, profile?.display_name, profile?.email]);

  if (!needsTap || dismissed) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-4 py-2.5 text-sm shadow-2xl backdrop-blur">
      <button
        onClick={() => {
          if (recapRef.current) {
            speakWithBrowserVoice(recapRef.current, readActiveCoach(), null, { onStart: markPlayed, onEnd: markPlayed });
          }
          setNeedsTap(false);
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