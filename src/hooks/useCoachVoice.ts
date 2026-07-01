import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const VOICE_KEY = "trademind.voice.enabled";
const VOICE_EVENT = "trademind.voice.enabled.changed";

let inMemoryVoiceEnabled: boolean | null = null;
let voicePreferenceTouched = false;

function readVoiceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (inMemoryVoiceEnabled !== null) return inMemoryVoiceEnabled;
  const v = window.localStorage.getItem(VOICE_KEY);
  if (v === "1") return true;
  if (v === "0") return false;
  // Default ON unless the welcome-back greeting has been muted.
  try {
    return window.localStorage.getItem("trademind.welcomeBack.muted.v1") !== "1";
  } catch {
    return true;
  }
}


function rememberVoiceEnabled(enabled: boolean) {
  inMemoryVoiceEnabled = enabled;
  try { window.localStorage.setItem(VOICE_KEY, enabled ? "1" : "0"); } catch { /* ignore */ }
}

function broadcastVoiceEnabled() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(VOICE_EVENT));
}

// 1-frame silent WAV - used to "unlock" the audio element inside a user gesture
// so later .play() calls (after async fetch) are allowed on iOS / mobile Safari.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function useCoachVoice() {
  const [enabled, setEnabledState] = useState<boolean>(() => readVoiceEnabled());
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const unlockedRef = useRef(false);
  const lastBlobUrlRef = useRef<string | null>(null);
  const syncedRef = useRef(false);
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const markDone = useCallback(() => {
    speakingRef.current = false;
    setSpeaking(false);
  }, []);


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

  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      audioContextRef.current = new AudioContextCtor({ sampleRate: 44100 });
    }
    return audioContextRef.current;
  }, []);

  // Call inside a user gesture (click/tap) to unlock mobile autoplay.
  // Safe to call repeatedly.
  const prime = useCallback(() => {
    const ctx = getAudioContext();
    if (ctx) {
      void ctx.resume().then(() => {
        try {
          const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start();
          unlockedRef.current = true;
        } catch {
          /* ignore */
        }
      }).catch(() => {
        /* ignore */
      });
    }
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
  }, [getAudio, getAudioContext]);

  useEffect(() => {
    const sync = () => setEnabledState(readVoiceEnabled());
    const syncStorage = (event: StorageEvent) => {
      if (event.key === VOICE_KEY) {
        inMemoryVoiceEnabled = event.newValue === "1";
        sync();
      }
    };
    window.addEventListener(VOICE_EVENT, sync);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener(VOICE_EVENT, sync);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  // On mount: hydrate from profile (cross-device), fall back to localStorage
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) return;
        const { data: prof } = await supabase
          .from("profiles")
          .select("voice_enabled")
          .eq("id", data.user.id)
          .maybeSingle();
        if (prof && typeof prof.voice_enabled === "boolean") {
          if (voicePreferenceTouched) return;
          rememberVoiceEnabled(prof.voice_enabled);
          setEnabledState(prof.voice_enabled);
          broadcastVoiceEnabled();
        }
      } catch {
        /* keep local voice preference */
      }
    })();
  }, []);

  // Persist on change: local + profile. Toggling on is a gesture - prime now.
  const setEnabled = useCallback((v: boolean) => {
    voicePreferenceTouched = true;
    rememberVoiceEnabled(v);
    setEnabledState(v);
    broadcastVoiceEnabled();
    if (v) prime();
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) return;
        await supabase.from("profiles").update({ voice_enabled: v }).eq("id", data.user.id);
      } catch {
        /* local preference already saved */
      }
    })();
  }, [prime]);

  const stop = useCallback(() => {
    genRef.current += 1;
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
      abortRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.onended = null; } catch { /* ignore */ }
      try { sourceRef.current.stop(); } catch { /* ignore */ }
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
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
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    }
    markDone();
  }, [markDone]);


  const speak = useCallback(async (text: string, voiceId: string) => {
    if (!text.trim()) return;
    // Ignore rapid repeat clicks while audio is already playing.
    if (speakingRef.current) return;
    const el = getAudio();
    const ctx = getAudioContext();
    if (!el && !ctx) return;
    const myGen = ++genRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    speakingRef.current = true;
    setSpeaking(true);
    const isStale = () => myGen !== genRef.current;
    if (sourceRef.current) {
      try { sourceRef.current.stop(); } catch { /* ignore */ }
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (el) try { el.pause(); } catch { /* ignore */ }
    if (lastBlobUrlRef.current) {
      URL.revokeObjectURL(lastBlobUrlRef.current);
      lastBlobUrlRef.current = null;
    }
    const fallback = async () => {
      if (isStale()) return;
      try {
        const { speakWithWebSpeech } = await import("@/lib/webSpeech");
        if (isStale()) return;
        await speakWithWebSpeech(text, voiceId);
      } catch { /* ignore */ }
      if (!isStale()) markDone();
    };
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
        signal: controller.signal,
      });
      if (isStale()) return;
      if (res.status === 204) {
        await fallback();
        return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn("[voice] tts failed, falling back to browser voice", res.status, body);
        await fallback();
        return;
      }
      const blob = await res.blob();
      if (isStale()) return;
      if (!blob.size) { await fallback(); return; }
      if (ctx) {
        try {
          await ctx.resume();
          const audioBuffer = await ctx.decodeAudioData(await blob.arrayBuffer());
          if (isStale()) return;
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.onended = () => {
            if (sourceRef.current === source) sourceRef.current = null;
            if (!isStale()) markDone();
          };
          sourceRef.current = source;
          source.start(0);
          return;
        } catch (e) {
          if (isStale()) return;
          console.warn("[voice] web audio failed", e);
        }
      }
      if (!el) { markDone(); return; }
      const url = URL.createObjectURL(blob);
      lastBlobUrlRef.current = url;
      el.src = url;
      el.muted = false;
      el.volume = 1;
      el.onended = () => {
        if (lastBlobUrlRef.current === url) {
          URL.revokeObjectURL(url);
          lastBlobUrlRef.current = null;
        }
        if (!isStale()) markDone();
      };
      await el.play().catch(async (e) => {
        if (isStale()) return;
        console.warn("[voice] play blocked, using browser voice", e);
        await fallback();
      });
    } catch (e) {
      if (isStale() || (e as { name?: string })?.name === "AbortError") return;
      console.warn("[voice] error, using browser voice", e);
      await fallback();
    }
  }, [getAudio, getAudioContext, markDone]);


  useEffect(() => stop, [stop]);

  return { enabled, setEnabled, speak, stop, prime, speaking };
}

