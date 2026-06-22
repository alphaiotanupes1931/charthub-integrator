import { useCallback, useEffect, useRef, useState } from "react";

const VOICE_KEY = "trademind.voice.enabled";

export function useCoachVoice() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(VOICE_KEY) === "1";
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VOICE_KEY, enabled ? "1" : "0");
  }, [enabled]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
      audioRef.current = null;
    }
  }, []);

  const speak = useCallback(async (text: string, voiceId: string) => {
    if (!text.trim()) return;
    stop();
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!res.ok) {
        console.error("[voice] tts failed", res.status, await res.text().catch(() => ""));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play().catch((e) => console.warn("[voice] play blocked", e));
    } catch (e) {
      console.error("[voice] error", e);
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { enabled, setEnabled, speak, stop };
}
