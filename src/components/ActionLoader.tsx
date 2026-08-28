import { cn } from "@/lib/utils";

type Props = {
  /** What is happening right now, e.g. "Logging trade". */
  label: string;
  /** Optional second line for extra context. */
  hint?: string;
  size?: "sm" | "md";
  className?: string;
  /** Inline (button/row) instead of a centered block. */
  inline?: boolean;
};

/**
 * One loading treatment for the whole app: a candle-style pulse bar plus the
 * exact action being performed, so users always know what is running.
 */
export function ActionLoader({ label, hint, size = "md", className, inline }: Props) {
  const bars = size === "sm" ? [6, 10, 7, 11] : [10, 16, 12, 18];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        inline ? "inline-flex items-center gap-2" : "flex flex-col items-center justify-center gap-2 text-center",
        className,
      )}
    >
      <span className="flex items-end gap-[3px]" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] bg-primary/80 animate-[pulse_1s_cubic-bezier(0.4,0,0.6,1)_infinite]"
            style={{ height: `${h}px`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </span>
      <span className={cn("flex items-baseline gap-1", size === "sm" ? "text-xs" : "text-sm")}>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground animate-pulse">...</span>
      </span>
      {hint && !inline ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
