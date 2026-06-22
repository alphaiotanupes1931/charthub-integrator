import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const VOICE_KEY = "trademind.voice.enabled";

// 1-frame silent WAV — used to "unlock" the audio element inside a user gesture
// so later .play() calls (after async fetch) are allowed on iOS / mobile Safari.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function useCoachVoice() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(VOICE_KEY) === "1";
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const lastBlobUrlRef = useRef<string | null>(null);
  const syncedRef = useRef(false);

  // Lazily mint the persistent audio element on the client.
  const getAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined") return null;
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  // Call inside a user gesture (click/tap) to unlock mobile autoplay.
  // Safe to call repeatedly.
  const prime = useCallback(() => {
    if (unlockedRef.current) return;
    const el = getAudio();
    if (!el) return;
    try {
      el.src = SILENT_WAV;
      el.muted = true;
      const p = el.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
          unlockedRef.current = true;
        }).catch(() => {
          // Stays locked; we'll try again next gesture.
          el.muted = false;
        });
      } else {
        el.pause();
        el.muted = false;
        unlockedRef.current = true;
      }
    } catch {
      /* ignore */
    }
  }, [getAudio]);

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

  // Persist on change: local + profile. Toggling on is a gesture — prime now.
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    if (v) prime();
    try { window.localStorage.setItem(VOICE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      await supabase.from("profiles").update({ voice_enabled: v }).eq("id", data.user.id);
    })();
  }, [prime]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try { a.pause(); } catch { /* ignore */ }
      a.removeAttribute("src");
      a.load();
    }
    if (lastBlobUrlRef.current) {
      URL.revokeObjectURL(lastBlobUrlRef.current);
      lastBlobUrlRef.current = null;
    }
  }, []);

  const speak = useCallback(async (text: string, voiceId: string) => {
    if (!text.trim()) return;
    const el = getAudio();
    if (!el) return;
    // Stop any previous playback but DON'T destroy the element — we need it
    // to keep its unlocked status for mobile autoplay.
    try { el.pause(); } catch { /* ignore */ }
    if (lastBlobUrlRef.current) {
      URL.revokeObjectURL(lastBlobUrlRef.current);
      lastBlobUrlRef.current = null;
    }
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
      lastBlobUrlRef.current = url;
      el.src = url;
      el.onended = () => {
        if (lastBlobUrlRef.current === url) {
          URL.revokeObjectURL(url);
          lastBlobUrlRef.current = null;
        }
      };
      await el.play().catch((e) => console.warn("[voice] play blocked", e));
    } catch (e) {
      console.error("[voice] error", e);
    }
  }, [getAudio]);

  useEffect(() => stop, [stop]);

  return { enabled, setEnabled, speak, stop, prime };
}
