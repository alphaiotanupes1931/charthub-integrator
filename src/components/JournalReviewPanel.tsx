// Journal intelligence: the coach reads the log and names the repeating errors,
// with the mental-state vs P&L correlation computed from the same trades.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Loader2, Brain } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reviewJournal, type JournalReview } from "@/lib/journal-intel.functions";

export type ReviewTradeInput = {
  date: string;
  symbol: string;
  side?: string;
  pnl?: number;
  rr?: number;
  session?: string;
  notes?: string;
  followedPlan?: boolean;
};

export type ReviewMentalInput = { date: string; score: number; mood?: string };

export default function JournalReviewPanel({
  trades,
  mental,
}: {
  trades: ReviewTradeInput[];
  mental: ReviewMentalInput[];
}) {
  const run = useServerFn(reviewJournal);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<JournalReview | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      setReview(await run({ data: { trades, mental } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Brain className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-medium">Coach review of your log</h2>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Reads every closed trade and your mental-state check-ins, then reports the mistakes that repeat and what
              you already do well. The correlation table is computed from your numbers, not guessed.
            </p>
          </div>
        </div>
        <motion.div whileTap={{ scale: 0.98 }}>
          <Button size="sm" onClick={submit} disabled={busy || trades.length === 0}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Run review
          </Button>
        </motion.div>
      </div>

      {review && (
        <div className="mt-4 space-y-4">
          <p className="text-sm leading-relaxed">{review.summary}</p>

          {review.mistakes.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Repeating mistakes</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {review.mistakes.map((m) => (
                  <li key={m} className="border-l border-border pl-3">{m}</li>
                ))}
              </ul>
            </div>
          )}

          {review.strengths.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">What is working</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {review.strengths.map((s) => (
                  <li key={s} className="border-l border-border pl-3">{s}</li>
                ))}
              </ul>
            </div>
          )}

          {review.correlations.byMentalScore.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Mental state against results</h3>
              <table className="mt-2 w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-normal">Score</th>
                    <th className="py-2 text-right font-normal">Trades</th>
                    <th className="py-2 text-right font-normal">Net P&amp;L</th>
                    <th className="py-2 text-right font-normal">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  {review.correlations.byMentalScore.map((r) => (
                    <tr key={r.score} className="border-b border-border/50">
                      <td className="py-2">{r.score} / 5</td>
                      <td className="py-2 text-right">{r.trades}</td>
                      <td className={`py-2 text-right ${r.netPnl > 0 ? "text-emerald-500" : r.netPnl < 0 ? "text-red-500" : ""}`}>
                        {r.netPnl}
                      </td>
                      <td className="py-2 text-right">{r.winRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {review.correlations.calmVsRushed && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Calm days (4 or 5) net {review.correlations.calmVsRushed.calmNetPnl}. Rushed days (1 or 2) net{" "}
                  {review.correlations.calmVsRushed.rushedNetPnl}.
                </p>
              )}
              {review.correlations.bestSession && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Best session: {review.correlations.bestSession}
                  {review.correlations.worstSession ? `. Worst: ${review.correlations.worstSession}.` : "."}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
