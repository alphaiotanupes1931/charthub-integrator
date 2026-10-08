import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import { getMyTraderProfile, dismissTraderTypePrompt } from "@/lib/trader-profile.functions";

/** One-time, skippable prompt for accounts that signed up before trader types existed. */
export function TraderTypePrompt({ className = "" }: { className?: string }) {
  const [show, setShow] = useState(false);
  const fetchProfile = useServerFn(getMyTraderProfile);
  const dismiss = useServerFn(dismissTraderTypePrompt);

  useEffect(() => {
    let cancelled = false;
    fetchProfile().then((r) => { if (!cancelled && !r.profile && !r.promptDismissed) setShow(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [fetchProfile]);

  if (!show) return null;
  return (
    <div className={`rounded-xl border border-primary/30 bg-primary/5 p-3.5 flex items-start gap-3 ${className}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">Find your trader type</div>
        <div className="text-xs text-muted-foreground mt-0.5">A few quick questions, then we set up your coach, strategy and risk rails for you.</div>
        <Link to="/trader-type" className="inline-block mt-2 text-xs font-semibold text-primary hover:underline">Start</Link>
      </div>
      <button aria-label="Dismiss" onClick={() => { setShow(false); dismiss().catch(() => {}); }}
        className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
    </div>
  );
}
