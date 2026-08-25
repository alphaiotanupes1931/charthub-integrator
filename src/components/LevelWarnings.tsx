// Inline explanation of unrealistic entry / stop / target levels, with a
// one-click correction when a concrete replacement exists.
import { AlertTriangle, AlertOctagon } from "lucide-react";
import type { LevelIssue } from "@/lib/levelValidation";

export function LevelWarnings({
  issues,
  onApply,
}: {
  issues: LevelIssue[];
  onApply?: (issue: LevelIssue) => void;
}) {
  if (!issues.length) return null;
  return (
    <div className="space-y-2">
      {issues.map((i, idx) => {
        const isError = i.severity === "error";
        return (
          <div
            key={`${i.field}-${idx}`}
            className={`flex flex-wrap items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
              isError ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-border/60 bg-muted/40 text-foreground"
            }`}
          >
            {isError ? (
              <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{i.message}</div>
              <div className={isError ? "mt-0.5 opacity-80" : "mt-0.5 text-muted-foreground"}>{i.suggestion}</div>
            </div>
            {onApply && i.suggestedValue != null && (
              <button
                type="button"
                onClick={() => onApply(i)}
                className="shrink-0 rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
              >
                Use {i.suggestedValue}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
