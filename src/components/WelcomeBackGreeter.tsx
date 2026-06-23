import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useProfile } from "@/hooks/useProfile";
import { readActiveCoach, readJournal } from "@/lib/chat-client";
import { getLatestRecapContext } from "@/lib/welcomeBack.functions";
import {
  buildWelcomeBackRecap,
  isWelcomeBackMuted,
  latestJournalTrade,
  speakWithElevenLabs,
  spokenName,
  WELCOME_BACK_REQUEST_KEY,
  WELCOME_BACK_SESSION_KEY,
  type JournalTrade,
} from "@/lib/welcomeBack";

type PreparedWindow = Window & { __trademindWelcomeAudio?: HTMLAudioElement };

const WelcomeBackContext = createContext<{
  recapText: string | null;
  setRecapText: (text: string | null) => void;
}>({ recapText: null, setRecapText: () => {} });

export function WelcomeBackProvider({ children }: { children: ReactNode }) {
  const [recapText, setRecapText] = useState<string | null>(null);
  return (
    <WelcomeBackContext.Provider value={{ recapText, setRecapText }}>
      {children}
    </WelcomeBackContext.Provider>
  );
}

export function useWelcomeBackRecap() {
  return useContext(WelcomeBackContext);
}


function shouldPlayWelcome(): boolean {
  if (typeof window === "undefined") return false;
  if (isWelcomeBackMuted()) return false;
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

type WelcomeBackGreeterProps = { playOnMount?: boolean };

export function WelcomeBackGreeter({ playOnMount = true }: WelcomeBackGreeterProps) {
  const { profile } = useProfile();
  const { setRecapText } = useWelcomeBackRecap();
  const fetchContext = useServerFn(getLatestRecapContext);
  const runIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    let cancelled = false;
    const coach = readActiveCoach();
    const preparedAudio = (window as PreparedWindow).__trademindWelcomeAudio ?? null;
    delete (window as PreparedWindow).__trademindWelcomeAudio;

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

      // Always expose the text so the dashboard replay button can read it aloud.
      setRecapText(text);

      if (!playOnMount || !shouldPlayWelcome()) return;

      await speakWithElevenLabs(text, coach, preparedAudio, {
        onStart: markPlayed,
        onEnd: markPlayed,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.display_name, profile?.email, fetchContext, playOnMount, setRecapText]);

  return null;
}
