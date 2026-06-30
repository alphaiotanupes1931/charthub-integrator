// Browser Web Speech API fallback - free, offline, no API needed.
// Used when /api/tts is unavailable (out of credits, network error, etc).

let voicesCache: SpeechSynthesisVoice[] | null = null;

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve([]);
      return;
    }
    if (voicesCache && voicesCache.length) {
      resolve(voicesCache);
      return;
    }
    const v = window.speechSynthesis.getVoices();
    if (v.length) {
      voicesCache = v;
      resolve(v);
      return;
    }
    const handler = () => {
      voicesCache = window.speechSynthesis.getVoices();
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      resolve(voicesCache);
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Safety timeout
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 500);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[], coachVoiceId?: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  // Crude mapping: George/Matilda/Will -> male/female English voice preference
  const isFemale = coachVoiceId === "XrExE9yKIg1WjnnlVkGX"; // Matilda
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;
  if (isFemale) {
    const f = pool.find((v) => /female|samantha|victoria|karen|tessa|moira|fiona|allison/i.test(v.name));
    if (f) return f;
  } else {
    const m = pool.find((v) => /male|daniel|alex|fred|tom|aaron|oliver|arthur/i.test(v.name));
    if (m) return m;
  }
  return pool[0];
}

export function isWebSpeechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export async function speakWithWebSpeech(
  text: string,
  coachVoiceId?: string,
  handlers?: { onStart?: () => void; onEnd?: () => void; onError?: () => void },
): Promise<boolean> {
  if (!isWebSpeechAvailable()) return false;
  try {
    window.speechSynthesis.cancel();
    const voices = await getVoices();
    const utter = new SpeechSynthesisUtterance(text);
    const v = pickVoice(voices, coachVoiceId);
    if (v) utter.voice = v;
    utter.rate = 1;
    utter.pitch = 1;
    utter.volume = 1;
    utter.onstart = () => handlers?.onStart?.();
    utter.onend = () => handlers?.onEnd?.();
    utter.onerror = () => handlers?.onError?.();
    window.speechSynthesis.speak(utter);
    return true;
  } catch (e) {
    console.warn("[webSpeech] failed", e);
    handlers?.onError?.();
    return false;
  }
}

export function cancelWebSpeech() {
  if (isWebSpeechAvailable()) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}
