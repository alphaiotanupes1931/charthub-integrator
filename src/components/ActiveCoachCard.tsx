import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { readActiveCoach, COACH_KEY } from "@/lib/chat-client";

const COACH_META: Record<string, { tagline: string; dot: string }> = {
  "The Analyst":        { tagline: "Smart, institutional, measured.", dot: "bg-pink-400" },
  "The Disciplinarian": { tagline: "Rules over feelings. Always.",     dot: "bg-amber-400" },
  "The Mentor":         { tagline: "Patient, teaches the why.",        dot: "bg-emerald-400" },
  "The Minimalist":     { tagline: "Fewer trades. Bigger edge.",       dot: "bg-sky-400" },
  "The Psychologist":   { tagline: "Mind first. Trade second.",        dot: "bg-violet-400" },
};

export function ActiveCoachCard({ collapsed }: { collapsed?: boolean }) {
  const [coach, setCoach] = useState<string>(() =>
    typeof window === "undefined" ? "The Analyst" : readActiveCoach(),
  );

  useEffect(() => {
    const sync = () => setCoach(readActiveCoach());
    const onStorage = (e: StorageEvent) => { if (e.key === COACH_KEY) sync(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const meta = COACH_META[coach] ?? { tagline: "Your active coach.", dot: "bg-primary" };

  if (collapsed) {
    return (
      <Link
        to="/coaches"
        className="mx-2 my-2 flex items-center justify-center h-10 w-10 rounded-lg border border-border/60 bg-card/60 hover:border-primary/50 transition"
        title={`Active coach: ${coach}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
      </Link>
    );
  }

  return (
    <div className="px-3 pb-3">
      <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" /> AI Coach
      </div>
      <Link
        to="/coaches"
        className="block rounded-lg border border-border/60 bg-card/60 hover:border-primary/50 transition p-2.5"
      >
        <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-primary mb-1">Active</div>
        <div className="flex items-center gap-2">
          <div className={`h-6 w-6 shrink-0 rounded-full ${meta.dot} opacity-80`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{coach}</div>
            <div className="text-[10px] text-muted-foreground truncate">{meta.tagline}</div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </div>
      </Link>
    </div>
  );
}
