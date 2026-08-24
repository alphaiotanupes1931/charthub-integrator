import { useMemo, useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { extractPriorScans, PRIOR_SCAN_LIMIT } from "@/lib/ai-context";
import { useTimezone, formatInTimezone } from "@/hooks/useTimezone";

type ChatLikeMessage = { role: string; parts?: unknown };

/**
 * Shows exactly which prior scans - with their grade and levels - were handed
 * to the coach for the next question in this thread. Reads the same fenced
 * chart-grade blocks and the same window the chat route uses, so the panel can
 * never disagree with what the model actually saw.
 */
export function AiContextInspector({
  messages,
  className,
}: {
  messages: ChatLikeMessage[];
  className?: string;
}) {
  const { effectiveTimezone } = useTimezone();
  const [open, setOpen] = useState(false);
  const scans = useMemo(() => extractPriorScans(messages ?? []), [messages]);

  if (scans.length === 0) return null;

  const included = scans.filter((s) => s.included);
  const dropped = scans.length - included.length;

  const when = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return formatInTimezone(d, effectiveTimezone, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className={`rounded-xl border border-border/50 bg-background/40 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10px] font-bold tracking-wider text-foreground"
        title="The scans the coach is given as context for your next question"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Brain className="h-3 w-3 text-muted-foreground" />
        AI CONTEXT
        <span className="ml-1 font-normal tracking-normal text-muted-foreground">
          {included.length} scan{included.length === 1 ? "" : "s"} in context
          {dropped > 0 ? ` · ${dropped} older dropped` : ""}
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-border/40 p-2.5 pt-2">
          <p className="text-[10px] text-muted-foreground">
            The coach receives the newest {PRIOR_SCAN_LIMIT} scans from this conversation, with grade,
            bias and levels. Anything marked dropped is out of the window and will not be quoted.
          </p>
          {[...scans].reverse().map((s, i) => (
            <div
              key={`${s.turn}-${i}`}
              className={`rounded-lg border p-2 text-[10px] ${
                s.included ? "border-border/60" : "border-border/30 opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-foreground">{s.symbol ?? "—"}</span>
                {s.timeframe && <span className="text-muted-foreground">{s.timeframe}</span>}
                <span className="rounded-lg border border-border/60 px-1.5 font-bold text-foreground">
                  {s.grade ?? "—"}
                </span>
                {s.bias && <span className="capitalize text-muted-foreground">{s.bias}</span>}
                {s.confidence && <span className="text-muted-foreground">{s.confidence}% conf</span>}
                <span className="flex-1" />
                <span className={s.included ? "text-foreground" : "text-muted-foreground"}>
                  {s.included ? "in context" : "dropped"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-muted-foreground">
                {([
                  ["E", s.entry],
                  ["SL", s.stop],
                  ["TP1", s.tp1],
                  ["TP2", s.tp2],
                  ["R:R", s.rr],
                  ["price used", s.refPrice],
                ] as const).map(([label, val]) =>
                  val ? (
                    <span key={label}>
                      {label} <span className="text-foreground">{val}</span>
                    </span>
                  ) : null,
                )}
              </div>
              <div className="mt-1 text-muted-foreground">
                {when(s.scannedAt) ? `Scanned ${when(s.scannedAt)} · ` : ""}from message {s.turn}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
