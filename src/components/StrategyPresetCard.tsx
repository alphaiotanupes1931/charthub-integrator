import { useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { findStrategyByName } from "@/lib/customStrategies";

/**
 * Shows the rules of the currently selected strategy preset so the trader can
 * see exactly which playbook their scans are being graded against.
 */
export function StrategyPresetCard({ name, className = "" }: { name: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!name) return null;
  const s = findStrategyByName(name);
  if (!s) return null;

  const meta: string[] = [];
  if ("style" in s && s.style) meta.push(String(s.style));
  if ("level" in s && s.level) meta.push(String(s.level));
  if ("rr" in s && s.rr != null) meta.push(`R:R ${s.rr}`);
  if ("winRate" in s && s.winRate != null) meta.push(`${s.winRate}% baseline win rate`);

  const playbook = ("playbook" in s && Array.isArray(s.playbook) ? s.playbook : []) ?? [];
  const customRules = "rules" in s && typeof s.rules === "string" ? s.rules : "";

  return (
    <div className={`border-b border-border/60 bg-card/30 px-3 py-2 text-xs ${className}`}>
      <div className="flex w-full items-center gap-2 text-left">
        <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-semibold">Strategy in use: {s.name}</span>
        {meta.length > 0 && (
          <span className="hidden sm:inline text-muted-foreground truncate">{meta.join(" · ")}</span>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-3 pb-1">
          {s.description && <p className="text-muted-foreground leading-snug">{s.description}</p>}
          {customRules && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Your rules</div>
              <p className="whitespace-pre-wrap leading-snug">{customRules}</p>
            </div>
          )}
          {playbook.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {playbook.map((sec) => (
                <div key={sec.title} className="rounded-md border border-border/60 bg-background/40 p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{sec.title}</div>
                  <ul className="space-y-1">
                    {sec.items.map((it, i) => (
                      <li key={i} className="flex gap-1.5 leading-snug">
                        <span className="text-primary">·</span>
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Scans and the AI coach grade setups against these rules. Change the preset from the strategy menu above.
          </p>
        </div>
      )}
    </div>
  );
}
