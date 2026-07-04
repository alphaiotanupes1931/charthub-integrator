import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, Volume2, VolumeX, ChevronDown, Loader2 } from "lucide-react";
import { COACH_VOICES } from "@/lib/coachVoices";
import { readActiveCoach, writeActiveCoach } from "@/lib/chat-client";
import { toast } from "sonner";



export const Route = createFileRoute("/_app/voice-coach")({
  head: () => ({ meta: [{ title: "Voice Coach, TradeMind" }] }),
  component: VoiceCoachPage,
});

const COACH_META: Record<string, { gender: string; accent: string; style: string }> = {
  "The Analyst": { gender: "Male", accent: "British", style: "Smart, institutional, measured pace" },
  "The Disciplinarian": { gender: "Male", accent: "US", style: "Commanding, strict, faster pace" },
  "The Mentor": { gender: "Female", accent: "Neutral", style: "Patient, warm, teaching pace" },
  "The Minimalist": { gender: "Male", accent: "Neutral", style: "Direct, no fluff, fast delivery" },
  "The Psychologist": { gender: "Female", accent: "US", style: "Empathetic, understanding, calm" },
};

const QUICK_PROMPTS = [
  "What's my edge today?",
  "Walk me through my last losing trade.",
  "Should I size up or stay defensive this session?",
  "Read the current confluence on XAUUSD.",
  "Coach me through patience while I wait for entry.",
];

const COACH_NAMES = Object.keys(COACH_META);

function VoiceCoachPage() {
  const [active, setActive] = useState<string>(() => {
    const a = readActiveCoach();
    return COACH_META[a] ? a : "The Analyst";
  });
  const [dropdown, setDropdown] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(80);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Tap the mic to talk");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<any>(null);

  useEffect(() => () => {
    cancelWebSpeech();
    audioRef.current?.pause();
    try { recRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const selectCoach = (name: string) => {
    writeActiveCoach(name);
    setActive(name);
    setDropdown(false);
  };

  const speak = async (_text: string) => {
    // AI voice output has been removed.
  };


  const askCoach = async (question: string) => {
    setReplying(true);
    setStatus("Thinking…");
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: question }] }],
          threadId: "voice-coach-ephemeral",
          coach: active,
        }),
      });
      if (res.status === 401) {
        const fallback = "Sign in to unlock live coaching replies. In the meantime, focus on your plan: define entry, stop, and target before you take the trade.";
        setStatus(fallback);
        await speak(fallback);
        return;
      }
      if (!res.ok || !res.body) throw new Error("chat failed");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value);
        chunk.split("\n").forEach((line) => {
          const m = line.match(/^data:\s*(.*)$/);
          if (!m) return;
          try {
            const j = JSON.parse(m[1]);
            if (j.type === "text-delta" && typeof j.delta === "string") full += j.delta;
            else if (typeof j.textDelta === "string") full += j.textDelta;
          } catch { /* ignore non-json */ }
        });
      }
      const clean = full.replace(/```[\s\S]*?```/g, "").trim() || "I heard you. Let me think on that.";
      setStatus(clean.slice(0, 220));
      await speak(clean);
    } catch {
      const fallback = "I'm having trouble reaching the coach right now. Try again in a moment, or use the AI Chat on the dashboard.";
      setStatus(fallback);
      await speak(fallback);
    } finally {
      setReplying(false);
    }
  };


  const toggleMic = () => {
    if (listening) { try { recRef.current?.stop(); } catch { /* ignore */ } return; }
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error("Voice input isn't supported in this browser. Try Chrome."); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { setListening(true); setStatus("Listening…"); };
    rec.onerror = (e: any) => {
      setListening(false);
      setStatus("Tap the mic to talk");
      if (e.error === "not-allowed") toast.error("Microphone access denied");
    };
    rec.onend = () => setListening(false);
    rec.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript?.trim();
      if (text) { setStatus(`You: ${text}`); askCoach(text); }
    };
    recRef.current = rec;
    try { rec.start(); } catch { setListening(false); }
  };

  const previewVoice = async (name: string) => {
    // AI voice output has been removed.
    if (previewing === name) {
      setPreviewing(null);
    } else {
      setPreviewing(name);
    }
  };


  return (
    <div className="p-4 md:p-8 max-w-[1000px] mx-auto">
      <h1 className="font-display text-4xl font-semibold mb-3">Voice Coach</h1>
      <p className="text-muted-foreground mb-6 leading-relaxed">
        Talk to TradeMind out loud. Tap the mic to dictate a question, then hear the AI respond in your
        selected coach's voice. This is the audio side of the same coaching personality you picked under{" "}
        <Link to="/coaches" className="text-primary font-semibold hover:underline">AI Coaches</Link> — it doesn't replace it.
      </p>

      {/* Active coach selector */}
      <div className="relative rounded-xl border border-primary/40 bg-primary/[0.03] p-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Mic className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-primary/80 uppercase tracking-wide">Active Coach</div>
            <button
              onClick={() => setDropdown((d) => !d)}
              className="flex items-center gap-2 text-primary font-semibold text-lg"
            >
              {active} <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
        {dropdown && (
          <div className="absolute left-4 right-4 top-full mt-1 z-20 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
            {COACH_NAMES.map((n) => (
              <button
                key={n}
                onClick={() => selectCoach(n)}
                className={`block w-full text-left px-3 py-2 text-sm hover:bg-muted ${n === active ? "text-primary font-semibold" : ""}`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mic */}
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <button
          onClick={toggleMic}
          disabled={replying}
          className={`relative h-24 w-24 rounded-full flex items-center justify-center transition ${
            listening
              ? "bg-primary text-primary-foreground shadow-[0_0_60px_hsl(var(--primary)/0.5)]"
              : "bg-primary/10 text-primary hover:bg-primary/20 shadow-[0_0_40px_hsl(var(--primary)/0.25)]"
          }`}
          aria-label={listening ? "Stop listening" : "Start listening"}
        >
          {replying ? <Loader2 className="h-8 w-8 animate-spin" /> : <Mic className="h-8 w-8" />}
        </button>
        <div className="text-primary font-medium text-center max-w-lg">{status}</div>
      </div>

      {/* Quick prompts */}
      <div className="rounded-xl border border-border bg-card p-5 mb-6">
        <h3 className="font-display text-lg font-semibold mb-1">Quick prompts</h3>
        <p className="text-xs text-muted-foreground mb-4">Tap to hear it spoken in the active coach's voice.</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => { setStatus(`You: ${p}`); askCoach(p); }}
              disabled={replying || listening}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:border-primary/40 hover:text-primary transition disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Voice settings */}
      <div className="rounded-xl border border-border bg-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold">Voice Settings</h3>
          <div className="flex items-center gap-2">
            {voiceOn ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
            <button
              onClick={() => { setVoiceOn((v) => !v); if (voiceOn) { audioRef.current?.pause(); cancelWebSpeech(); } }}
              className={`relative h-6 w-11 rounded-full transition ${voiceOn ? "bg-primary" : "bg-muted"}`}
              aria-label="Toggle voice output"
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${voiceOn ? "left-5" : "left-0.5"}`} />
            </button>
          </div>
        </div>
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span>Speed</span><span className="text-muted-foreground">{speed.toFixed(1)}x</span>
            </div>
            <input
              type="range" min={0.5} max={2} step={0.1} value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
              <span>Slower</span><span>Normal</span><span>Faster</span>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span>Volume</span><span className="text-muted-foreground">{volume}%</span>
            </div>
            <input
              type="range" min={0} max={100} step={5} value={volume}
              onChange={(e) => setVolume(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Coach voices */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-display text-lg font-semibold mb-1">Coach Voices</h3>
        <p className="text-xs text-muted-foreground mb-4">Each coach has a unique voice. Preview them below.</p>
        <div className="space-y-2">
          {COACH_NAMES.map((n) => {
            const meta = COACH_META[n];
            const isPrev = previewing === n;
            return (
              <div key={n} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Volume2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{n}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {meta.gender} · {meta.accent} · {meta.style}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => previewVoice(n)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20"
                >
                  {isPrev ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {isPrev ? "Stop" : "Preview"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
