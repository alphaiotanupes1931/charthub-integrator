import { BookOpen } from "lucide-react";
import { findStrategyByName } from "@/lib/customStrategies";

/**
 * Compact one-line badge naming the strategy preset the scans are graded
 * against. The expandable rules list was removed from the dashboard to keep the
 * chart header clean; full rules live on the Strategies page.
 */
export function StrategyPresetCard({ name, className = "" }: { name: string | null; className?: string }) {
  if (!name) return null;
  const s = findStrategyByName(name);
  if (!s) return null;

  const meta: string[] = [];
  if ("style" in s && s.style) meta.push(String(s.style));
  if ("level" in s && s.level) meta.push(String(s.level));
  if ("rr" in s && s.rr != null) meta.push(`R:R ${s.rr}`);
  if ("winRate" in s && s.winRate != null) meta.push(`${s.winRate}% baseline win rate`);

  return (
    <div className={`border-b border-border/60 bg-card/30 px-3 py-2 text-xs ${className}`}>
      <div className="flex w-full items-center gap-2 text-left">
        <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-semibold">Strategy in use: {s.name}</span>
        {meta.length > 0 && (
          <span className="hidden sm:inline text-muted-foreground truncate">{meta.join(" · ")}</span>
        )}
      </div>
    </div>
  );
}
