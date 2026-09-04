// Admin: re-measure per-instrument behaviour from real history bars.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Gauge, Loader2, RefreshCw } from "lucide-react";
import { getInstrumentProfiles, refreshInstrumentProfiles } from "@/lib/instrument-profile.functions";
import { SESSION_LABEL, type SessionKey } from "@/lib/instrument-profile.shared";

export function InstrumentProfilePanel() {
  const qc = useQueryClient();
  const load = useServerFn(getInstrumentProfiles);
  const refresh = useServerFn(refreshInstrumentProfiles);

  const profiles = useQuery({
    queryKey: ["instrument-profiles"],
    queryFn: () => load(),
    staleTime: 60_000,
  });

  const run = useMutation({
    mutationFn: () => refresh({ data: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["instrument-profiles"] }),
  });

  const rows = profiles.data?.profiles ?? [];

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4" /> Instrument profiles
          <span className="font-normal text-muted-foreground">({rows.length} measured)</span>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-1.5 text-xs font-semibold hover:text-foreground disabled:opacity-60"
        >
          {run.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {run.isPending ? "Measuring every instrument…" : "Re-measure all"}
        </button>
      </div>

      {run.data && (
        <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
          Measured {run.data.measured.length}
          {run.data.failed.length ? ` · failed: ${run.data.failed.map((f) => `${f.symbol} (${f.error})`).join(", ")}` : ""}
        </div>
      )}
      {run.isError && (
        <div className="border-b border-border/60 px-4 py-2 text-xs text-red-500">
          Measurement failed. Admin access and a working history feed are required.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border/60 text-left">
              <th className="px-4 py-2 font-medium">Symbol</th>
              <th className="px-3 py-2 font-medium">Bars</th>
              <th className="px-3 py-2 font-medium">ATR</th>
              <th className="px-3 py-2 font-medium">ATR %</th>
              <th className="px-3 py-2 font-medium">Pullback</th>
              <th className="px-3 py-2 font-medium">Session</th>
              <th className="px-3 py-2 font-medium">Entry gate</th>
              <th className="px-3 py-2 font-medium">Stop buffer</th>
              <th className="px-3 py-2 font-medium">Measured</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                  Nothing measured yet. Run "Re-measure all" to build the profiles.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.symbol}>
                  <td className="px-4 py-2 font-semibold">{p.symbol}</td>
                  <td className="px-3 py-2 font-mono">{p.barsSampled}</td>
                  <td className="px-3 py-2 font-mono">{p.atr4h}</td>
                  <td className="px-3 py-2 font-mono">{p.atrPct.toFixed(2)}%</td>
                  <td className="px-3 py-2 font-mono">
                    {(p.medianPullback * 100).toFixed(0)}% / {(p.deepPullback * 100).toFixed(0)}%
                  </td>
                  <td className="px-3 py-2">{SESSION_LABEL[p.bestSession as SessionKey] ?? p.bestSession}</td>
                  <td className="px-3 py-2 font-mono">{p.maxEntryDistanceAtr}x</td>
                  <td className="px-3 py-2 font-mono">{p.stopBufferAtr}x</td>
                  <td className="px-3 py-2 text-muted-foreground">{new Date(p.measuredAt).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
