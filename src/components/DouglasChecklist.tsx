// Mark Douglas checklist — the mindset model is psychology only, so it shows up
// under each trade as a discipline checklist rather than as a signal. The number
// of yeses is what drives the confidence number on the scan.

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { DOUGLAS_CHECKLIST } from "@/lib/analysis-models/douglas-engine";

export function douglasConfidence(checked: ReadonlySet<number>): number {
  if (DOUGLAS_CHECKLIST.length === 0) return 0;
  return Math.round((checked.size / DOUGLAS_CHECKLIST.length) * 100);
}

export function DouglasChecklist({
  checked,
  onToggle,
}: {
  checked: ReadonlySet<number>;
  onToggle: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = DOUGLAS_CHECKLIST.length;
  const done = checked.size;
  const complete = done === total;

  return (
    <div className="rounded-sm border border-border/60 bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
        title="Mark Douglas discipline checklist"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-foreground">
          Mark Douglas checklist
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
              complete ? "text-bull" : "text-muted-foreground"
            }`}
          >
            {complete ? "All yes" : `${done}/${total} yes`}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-3 py-2.5 space-y-1.5">
          {DOUGLAS_CHECKLIST.map((item, i) => {
            const on = checked.has(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => onToggle(i)}
                className="flex w-full items-start gap-2.5 rounded-sm px-1 py-1 text-left hover:bg-muted/40 transition"
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                    on ? "border-bull bg-bull/15 text-bull" : "border-border text-transparent"
                  }`}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className={`text-[11px] leading-snug ${on ? "text-foreground" : "text-muted-foreground"}`}>
                  {item}
                </span>
              </button>
            );
          })}
          <div className="pt-1 text-[10px] leading-snug text-muted-foreground">
            {complete
              ? "Checklist complete — execute it mechanically and leave the stop where it is."
              : "Every answer has to be yes before you execute. Each yes raises the confidence on this scan."}
          </div>
        </div>
      )}
    </div>
  );
}
