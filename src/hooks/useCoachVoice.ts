import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const VOICE_KEY = "trademind.voice.enabled";

export function useCoachVoice() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(VOICE_KEY) === "1";
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncedRef = useRef(false);

  // On mount: hydrate from profile (cross-device), fall back to localStorage
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const { data: prof } = await supabase
        .from("profiles")
        .select("voice_enabled")
        .eq("id", data.user.id)
        .maybeSingle();
      if (prof && typeof prof.voice_enabled === "boolean") {
        setEnabledState(prof.voice_enabled);
        try { window.localStorage.setItem(VOICE_KEY, prof.voice_enabled ? "1" : "0"); } catch { /* ignore */ }
      }
    })();
  }, []);

  // Persist on change: local + profile
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try { window.localStorage.setItem(VOICE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      await supabase.from("profiles").update({ voice_enabled: v }).eq("id", data.user.id);
    })();
  }, []);

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
