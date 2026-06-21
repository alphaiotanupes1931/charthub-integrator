import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Mic, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/_app/voice-coach")({
  head: () => ({ meta: [{ title: "Voice Coach — TradeMind" }] }),
  component: VoicePage,
});

const PROMPTS = [
  "What's my edge today?",
  "Walk me through my last losing trade.",
  "Should I size up or stay defensive this session?",
  "Read the current confluence on XAUUSD.",
  "Coach me through patience while I wait for entry.",
];

function VoicePage() {
  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <PageHeader
        title="Voice Coach"
        description={
          <>
            Talk to TradeMind out loud. Tap the mic to dictate a question, then hear the AI respond in your selected coach's voice. This is the audio side of the same coaching personality you picked under <span className="text-foreground font-semibold">AI Coaches</span> — it doesn't replace it.
          </>
        }
      />

      <div className="rounded-xl border border-border bg-card p-4 mb-10">
        <div className="text-xs text-muted-foreground flex items-center gap-2 mb-1">
          <Mic className="h-3.5 w-3.5 text-primary" /> Active Coach
        </div>
        <button className="flex items-center justify-between w-full text-left">
          <span className="font-display text-xl font-semibold text-primary">The Analyst</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="flex flex-col items-center py-12 space-y-3">
        <button className="h-20 w-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center hover:bg-primary/20 transition-colors shadow-[0_0_60px_-10px_rgba(201,162,39,0.5)]">
          <Mic className="h-8 w-8 text-primary" />
        </button>
        <div className="text-primary text-sm">Tap the mic to talk</div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-semibold text-base mb-1">Quick prompts</h3>
        <p className="text-xs text-muted-foreground mb-4">Tap to hear it spoken in the active coach's voice.</p>
        <div className="flex flex-wrap gap-2">
          {PROMPTS.map((p) => (
            <button key={p} className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:border-primary/40 hover:text-primary">
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
