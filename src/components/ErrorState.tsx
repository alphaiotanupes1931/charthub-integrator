import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = {
  /** What failed, in the user's words: "Couldn't load your journal". */
  title: string;
  /** Optional detail — usually the error message from the failed call. */
  detail?: string | null;
  /** Retry handler. When omitted, no retry button is shown. */
  onRetry?: () => void;
  /** True while the retry is in flight. */
  retrying?: boolean;
  retryLabel?: string;
  className?: string;
  compact?: boolean;
};

/**
 * Standard failure surface. Loaders should never just disappear: when a fetch or
 * a broker call fails, render this so the user sees what broke and can retry.
 */
export function ErrorState({ title, detail, onRetry, retrying = false, retryLabel = "Retry", className, compact = false }: Props) {
  return (
    <div
      role="alert"
      className={`animate-fade-in rounded-xl border border-red-500/40 bg-red-500/10 ${compact ? "p-3" : "p-5"} ${className ?? ""}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
        <div className="min-w-0">
          <div className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}>{title}</div>
          {detail && <p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p>}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="press-in mt-3 inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
              {retrying ? "Retrying…" : retryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ErrorState;
