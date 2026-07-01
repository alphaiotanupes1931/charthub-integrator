import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Bot, BarChart2, Target, GraduationCap, CheckCircle2, Volume2, Sparkles, Loader2, Square } from "lucide-react";
import { COACH_VOICES } from "@/lib/coachVoices";
import { readActiveCoach, writeActiveCoach } from "@/lib/chat-client";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/coaches")({
  head: () => ({ meta: [{ title: "AI Coaches, TradeMind" }] }),
  component: CoachesPage,
});

const COACHES = [
  {
    name: "The Analyst",
    subtitle: "Data-Driven Performance Optimizer",
    icon: BarChart2,
    iconBg: "bg-blue-500/20 text-blue-300",
    nameText: "text-blue-300",
    nameBg: "bg-blue-500/10 border border-blue-500/20",
    description:
      "Numbers don't lie. The Analyst breaks down your trading performance with surgical precision, win rates, R:R ratios, edge statistics, and pattern recognition across your data.",
    tone: "Precise & Analytical",
    strengths: ["Statistical analysis", "Pattern recognition", "Performance metrics", "Edge calculation"],
    bestFor: "Data-oriented traders who want to optimize performance through numbers and statistics",
  },
  {
    name: "The Disciplinarian",
    subtitle: "Rule Enforcer & Accountability Partner",
    icon: Target,
    iconBg: "bg-rose-500/20 text-rose-300",
    nameText: "text-rose-300",
    nameBg: "bg-rose-500/10 border border-rose-500/20",
    description:
      "No excuses, no shortcuts. The Disciplinarian holds you to your trading plan with zero tolerance for rule-breaking. Every deviation is tracked, every excuse challenged.",
    tone: "Strict & Direct",
    strengths: ["Rule enforcement", "Accountability tracking", "Breaking bad habits", "Building discipline routines"],
    bestFor: "Traders who struggle with discipline, revenge trading, or breaking their own rules",
  },
  {
    name: "The Mentor",
    subtitle: "Experienced Guide & Strategy Teacher",
    icon: GraduationCap,
    iconBg: "bg-purple-500/20 text-purple-300",
    nameText: "text-purple-300",
    nameBg: "bg-purple-500/10 border border-purple-500/20",
    description:
      "A patient, seasoned trader who's been through it all. The Mentor shares wisdom from decades of market experience, guiding you through concepts with real-world context.",
    tone: "Warm & Patient",
    strengths: ["Teaching through experience", "Building confidence", "Strategy development", "Long-term growth mindset"],
    bestFor: "Newer traders or those wanting a supportive, wisdom-driven coaching experience",
  },
];

function CoachesPage() {
  const [active, setActive] = useState<string>(() => readActiveCoach());
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const select = (name: string) => {
    writeActiveCoach(name);
    setActive(name);
    toast.success(`${name} is now your active coach`);
  };

  const stop = () => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.src = "";
    audioRef.current = null;
    setPreviewing(null);
  };

  const preview = async (name: string) => {
    if (previewing === name) { stop(); return; }
    stop();
    const v = COACH_VOICES[name];
    if (!v) return;
    setPreviewing(name);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: v.preview, voiceId: v.id }),
      });
      if (!res.ok) {
        toast.error("Voice preview failed");
        setPreviewing(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewing(null); };
      audio.onerror = () => { setPreviewing(null); };
      await audio.play();
    } catch {
      setPreviewing(null);
      toast.error("Voice preview failed");
    }
  };

  const activeCoach = COACHES.find((c) => c.name === active);

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="AI Coach Library"
        description={
          <>
            Pick the coaching personality that matches how you want to be coached. Your choice shapes the <span className="text-foreground font-semibold">tone, framing, and voice</span> of every AI response. Tap the speaker on any card to preview the voice.
          </>
        }
      />

      {/* Active coach banner */}
      <div className="rounded-xl border-2 border-primary/60 bg-primary/[0.03] p-6 mb-8">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-muted flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className={`inline-block rounded-md px-2.5 py-1 ${activeCoach?.nameBg ?? ""} ${activeCoach?.nameText ?? ""}`}>
                <h3 className="font-display text-2xl font-semibold truncate">{activeCoach?.name ?? active}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{activeCoach?.subtitle ?? "Active personality"}</p>
            </div>
          <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            <CheckCircle2 className="h-3 w-3" /> Active
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          The {active} drives every AI Coach reply on the Dashboard. Toggle the speaker icon in the chat panel to hear replies aloud.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {COACHES.map((c) => {
          const Icon = c.icon;
          const isActive = c.name === active;
          const isPreviewing = previewing === c.name;
          const voice = COACH_VOICES[c.name];
          return (
            <div
              key={c.name}
              className={`rounded-xl border bg-card p-5 space-y-4 flex flex-col transition ${
                isActive ? "border-primary/60 ring-1 ring-primary/30" : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${c.iconBg}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className={`flex-1 min-w-0 rounded-md px-2.5 py-1 ${c.nameBg}`}>
                  <h3 className={`font-display text-xl font-semibold truncate ${c.nameText}`}>{c.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{c.subtitle}</p>
                </div>
                <button
                  onClick={() => preview(c.name)}
                  title={isPreviewing ? "Stop preview" : `Preview ${voice?.label ?? "voice"}`}
                  aria-label={isPreviewing ? "Stop preview" : "Preview voice"}
                  className="h-9 w-9 rounded-md border border-border hover:border-primary/40 hover:text-primary flex items-center justify-center shrink-0"
                >
                  {isPreviewing ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">{c.description}</p>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Tone:</span>
                <span className="rounded border border-border bg-background px-2 py-0.5">{c.tone}</span>
                {voice && (
                  <span className="rounded border border-border bg-background px-2 py-0.5 text-muted-foreground truncate">
                    {voice.label}
                  </span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> <span className="font-semibold">Strengths</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.strengths.map((s) => (
                    <span key={s} className="rounded border border-border bg-background px-2 py-0.5 text-[11px]">{s}</span>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background/50 p-3 text-xs">
                <span className="font-semibold">Best for: </span>
                <span className="text-muted-foreground">{c.bestFor}</span>
              </div>
              <button
                onClick={() => select(c.name)}
                disabled={isActive}
                className={`w-full rounded-md py-2 text-sm font-semibold transition ${
                  isActive
                    ? "bg-primary/10 text-primary cursor-default"
                    : "bg-primary text-primary-foreground hover:opacity-90"
                }`}
              >
                {isActive ? (
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> Selected
                  </span>
                ) : (
                  "Select Coach"
                )}
              </button>
            </div>
          );
        })}
      </div>

      {previewing && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full border border-primary/40 bg-card px-4 py-2 text-xs flex items-center gap-2 shadow-lg">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Previewing {previewing}…
          <button onClick={stop} className="ml-2 text-muted-foreground hover:text-foreground">Stop</button>
        </div>
      )}
    </div>
  );
}
