import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { readActiveCoach, COACH_KEY } from "@/lib/chat-client";
import { COACH_ICON_META, DEFAULT_COACH_ICON } from "@/lib/coachMeta";

const COACH_TAGLINES: Record<string, string> = {
  "The Analyst": "Smart, institutional, measured.",
  "The Disciplinarian": "Rules over feelings. Always.",
  "The Mentor": "Patient, teaches the why.",
  "The Minimalist": "Fewer trades. Bigger edge.",
  "The Psychologist": "Mind first. Trade second.",
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

  const meta = COACH_ICON_META[coach] ?? DEFAULT_COACH_ICON;
  const tagline = COACH_TAGLINES[coach] ?? "Your active coach.";
  const Icon = meta.icon;

  if (collapsed) {
    return (
      <Link
        to="/coaches"
        className="mx-2 my-2 flex items-center justify-center h-10 w-10 rounded-lg border border-border/60 bg-card/60 hover:border-primary/50 transition"
        title={`Active coach: ${coach}`}
      >
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${meta.iconBg} ${meta.iconText}`}>
          <Icon className="h-4 w-4" />
        </span>
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
          <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${meta.iconBg} ${meta.iconText}`}>
            <Icon className="h-3 w-3" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{coach}</div>
            <div className="text-[10px] text-muted-foreground truncate">{tagline}</div>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </div>
      </Link>
    </div>
  );
}
