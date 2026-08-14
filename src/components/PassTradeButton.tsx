import { useEffect, useState } from "react";
import { Ban, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  findPassedTrade,
  onPassedTradesChange,
  recordPassedTrade,
  unpassTrade,
  type PassedTrade,
} from "@/lib/passedTrades";

export type PassTradeInput = {
  symbol: string;
  interval?: string;
  grade?: string;
  bias?: string;
  entry?: number | null;
  stop?: number | null;
  tp1?: number | null;
  threadId?: string;
};

const QUICK_REASONS = [
  "Grade too low",
  "Missed the entry",
  "Against higher timeframe",
  "News too close",
  "Already at daily risk",
  "Setup unclear",
];

/**
 * "Pass" records that the trader consciously skipped a setup, with the reason,
 * so passed setups can be reviewed alongside the ones they took.
 */
export function PassTradeButton({ setup, className = "" }: { setup: PassTradeInput; className?: string }) {
  const [passed, setPassed] = useState<PassedTrade | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const key = `${setup.symbol}|${setup.entry ?? ""}|${setup.threadId ?? ""}`;
  useEffect(() => {
    const sync = () =>
      setPassed(findPassedTrade({ symbol: setup.symbol, entry: setup.entry ?? null, threadId: setup.threadId ?? null }));
    sync();
    return onPassedTradesChange(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (passed) {
    return (
      <div className={`rounded-2xl border border-border/60 bg-card px-3.5 py-2.5 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-muted-foreground">You passed this trade</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {passed.reason || "No reason given"} · {new Date(passed.at).toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => { unpassTrade(passed.key); toast.success("Pass removed"); }}
            className="shrink-0 rounded-full border border-border/60 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40"
          >
            Undo
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-full border border-border/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/40 transition ${className}`}
        title="Record that you passed on this setup and why"
      >
        <Ban className="h-3.5 w-3.5" /> Pass this trade
      </button>
    );
  }

  const save = () => {
    recordPassedTrade({
      symbol: setup.symbol,
      interval: setup.interval,
      grade: setup.grade,
      bias: setup.bias,
      entry: setup.entry ?? null,
      stop: setup.stop ?? null,
      tp1: setup.tp1 ?? null,
      reason: reason.trim(),
      threadId: setup.threadId,
    });
    setOpen(false);
    setReason("");
    toast.success(`Passed ${setup.symbol} — saved with your reason`);
  };

  return (
    <div className={`rounded-2xl border border-border/60 bg-card p-3 space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Why are you passing {setup.symbol}?</div>
        <button onClick={() => setOpen(false)} aria-label="Cancel" className="h-6 w-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/40 flex items-center justify-center">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REASONS.map((r) => (
          <button
            key={r}
            onClick={() => setReason(r)}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
              reason === r ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={400}
        placeholder="Type your reason for passing this trade"
        className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:border-primary/50"
      />
      <button
        onClick={save}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent/70 px-4 py-2 text-xs font-semibold text-foreground hover:bg-accent transition"
      >
        <Check className="h-3.5 w-3.5" /> Save pass
      </button>
    </div>
  );
}

export default PassTradeButton;
