import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSignalScores, resolveMySignalScores } from "@/lib/signal-scores.functions";
import type { SignalScoreRow } from "@/lib/signal-scores.shared";
import type { SignalRecord } from "@/lib/signalHistory";

/**
 * How every scan played out, measured from real price bars rather than the
 * trader tagging anything. Each scan is filed server-side when it runs, a
 * background job walks the bars forward, and this hook matches those resolved
 * rows back onto the device-local scan history list.
 */
export function useSignalOutcomes() {
  const qc = useQueryClient();
  const load = useServerFn(listSignalScores);
  const resolve = useServerFn(resolveMySignalScores);

  const query = useQuery({
    queryKey: ["signal-scores", "history"],
    queryFn: () => load(),
    staleTime: 60_000,
    retry: false,
  });

  const rows = query.data ?? [];

  const recheck = useMutation({
    mutationFn: () => resolve(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signal-scores", "history"] });
      qc.invalidateQueries({ queryKey: ["signal-scoreboard"] });
    },
  });

  /** Nearest filed row for a local scan: same symbol, timeframe and entry, within 20 minutes. */
  const outcomeFor = useMemo(() => {
    return (rec: SignalRecord): SignalScoreRow | null => {
      if (!rows.length) return null;
      const at = rec.at;
      let best: SignalScoreRow | null = null;
      let bestGap = Infinity;
      for (const r of rows) {
        if (r.symbol !== rec.symbol || r.timeframe !== rec.interval) continue;
        if (typeof rec.entry === "number" && Math.abs(r.entry - rec.entry) > Math.abs(r.entry) * 0.002) continue;
        const gap = Math.abs(new Date(r.createdAt).getTime() - at);
        if (gap > 20 * 60 * 1000) continue;
        if (gap < bestGap) {
          bestGap = gap;
          best = r;
        }
      }
      return best;
    };
  }, [rows]);

  const totals = useMemo(() => {
    const targets = rows.filter((r) => r.status === "target").length;
    const stops = rows.filter((r) => r.status === "stop").length;
    const open = rows.filter((r) => r.status === "open").length;
    const expired = rows.filter((r) => r.status === "expired").length;
    const decided = targets + stops;
    const resolvedRows = rows.filter((r) => r.status !== "open");
    const rSum = resolvedRows.reduce((acc, r) => acc + (r.realizedR ?? 0), 0);
    return {
      filed: rows.length,
      targets,
      stops,
      open,
      expired,
      hitRate: decided ? Math.round((targets / decided) * 1000) / 10 : null,
      avgR: resolvedRows.length ? Math.round((rSum / resolvedRows.length) * 100) / 100 : null,
    };
  }, [rows]);

  return { rows, outcomeFor, totals, loading: query.isLoading, recheck };
}

/** Short label for a filed scan's measured outcome. */
export function outcomeLabel(row: SignalScoreRow | null): { text: string; tone: "win" | "loss" | "flat" | "open" } {
  if (!row) return { text: "Not tracked", tone: "flat" };
  if (row.status === "target") return { text: `Hit TP ${row.realizedR ?? ""}R`.trim(), tone: "win" };
  if (row.status === "stop") return { text: "Stopped -1R", tone: "loss" };
  if (row.status === "expired") return { text: `Expired ${row.realizedR ?? 0}R`, tone: "flat" };
  return { text: "Still open", tone: "open" };
}
