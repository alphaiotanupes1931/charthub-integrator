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
    <div className={`flex min-w-0 items-center gap-2 text-[11px] ${className}`}>
      <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate font-medium text-foreground/80">{s.name}</span>
      {meta.length > 0 && (
        <span className="hidden xl:inline truncate text-muted-foreground">{meta.join(" · ")}</span>
      )}
    </div>
  );
}
