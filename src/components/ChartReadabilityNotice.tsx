import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { useChartBackground } from "@/hooks/useChartBackground";
import { auditChartContrast, formatRatio } from "@/lib/chartContrast";

/**
 * Quiet readability check. If the chart palette makes the axis prices, time
 * labels or gridlines hard to read, this offers a one-tap switch to the
 * best-reading preset in the same light/dark family.
 */
export function ChartReadabilityNotice({ className = "" }: { className?: string }) {
  const { colors, setPreset } = useChartBackground();
  const [dismissed, setDismissed] = useState(false);
  const audit = auditChartContrast(colors);

  // A palette change is a fresh problem, so re-arm the notice.
  useEffect(() => {
    setDismissed(false);
  }, [colors.bg, colors.text, colors.grid]);

  if (dismissed || audit.issues.length === 0) return null;

  const worst = audit.issues[0]!;

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border border-amber-500/30 bg-background/90 px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground backdrop-blur ${className}`}
    >
      <Eye className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="min-w-0">
        <span className="font-medium text-foreground">Hard to read: </span>
        {worst.label.toLowerCase()} at {formatRatio(worst.ratio)} contrast
        {audit.suggestion ? (
          <>
            {". "}
            <button
              type="button"
              onClick={() => setPreset(audit.suggestion!)}
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              Switch to {audit.suggestion} ({formatRatio(audit.suggestionRatio)})
            </button>
          </>
        ) : (
          ". Pick a lighter text colour in Settings."
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss readability warning"
      >
        Hide
      </button>
    </div>
  );
}
