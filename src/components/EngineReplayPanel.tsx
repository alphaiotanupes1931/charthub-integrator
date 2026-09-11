// Published track record of the current engine measured on past price bars.
//
// Kept visually separate from live scan outcomes: these trades were never taken,
// they are the same deterministic rules replayed bar by bar over history.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BACKTEST_SYMBOLS, TIMEFRAME_LABEL, type BacktestTimeframe } from "@/lib/backtest/catalog";
import { listEngineReplay, refreshEngineReplay } from "@/lib/engine-replay.functions";
import {
  replayTotals,
  replayStatus,
  REPLAY_STATUS_LABEL,
  type ReplayRow,
} from "@/lib/engine-replay.shared";
import { InfoTip } from "@/components/InfoTip";

const TF: BacktestTimeframe = "60";

export default function EngineReplayPanel({ canRefresh = false }: { canRefresh?: boolean }) {
  const load = useServerFn(listEngineReplay);
  const refresh = useServerFn(refreshEngineReplay);
  const [rows, setRows] = useState<ReplayRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    load().then(setRows).catch(() => setRows([]));
  }, [load]);

  const runAll = async () => {
    for (const symbol of BACKTEST_SYMBOLS) {
      setBusy(symbol);
      try {
        const res = await refresh({ data: { symbol, timeframe: TF, lookback: "2y" } });
        if (!res.ok) toast.error(`${symbol}: ${res.error}`);
      } catch (e) {
        toast.error(`${symbol}: ${(e as Error).message}`);
      }
    }
    setBusy(null);
    setRows(await load());
    toast.success("Replay track record updated.");
  };

  const totals = replayTotals(rows);

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <History className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="flex items-center gap-1 text-sm font-semibold">
              Engine tested on past price
              <InfoTip term="Replay test" text="The current signal rules run bar by bar over two years of real price history. No trade was actually taken, and the result cannot see future bars." />
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Two years per instrument on the {TIMEFRAME_LABEL[TF].toLowerCase()} chart. Separate from live scan
              results above, which are the trades the coach actually called.
            </p>
          </div>
        </div>
        {canRefresh && (
          <Button size="sm" variant="outline" onClick={runAll} disabled={busy !== null}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {busy ? `Testing ${busy}` : "Re-run on all instruments"}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No replay results stored yet.{canRefresh ? " Run the test to publish a track record." : ""}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">Trades tested</div>
              <div className="mt-1 text-xl font-semibold">{totals.trades}</div>
              <div className="text-xs text-muted-foreground">{totals.instruments} instruments</div>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">Hit rate</div>
              <div className="mt-1 text-xl font-semibold">{totals.winRate == null ? "-" : `${totals.winRate}%`}</div>
              <div className="text-xs text-muted-foreground">all grades</div>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">A-grade hit rate</div>
              <div className="mt-1 text-xl font-semibold">{totals.aWinRate == null ? "-" : `${totals.aWinRate}%`}</div>
              <div className="text-xs text-muted-foreground">{totals.aTrades} A-grade trades</div>
            </div>
            <div className="rounded-xl border border-border/60 p-3">
              <div className="text-xs text-muted-foreground">Average R</div>
              <div className="mt-1 text-xl font-semibold">
                {totals.expectancyR == null ? "-" : `${totals.expectancyR}R`}
              </div>
              <div className="text-xs text-muted-foreground">per trade</div>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60 text-left">
                  <th className="py-2 font-normal">Instrument</th>
                  <th className="py-2 text-right font-normal">Trades</th>
                  <th className="py-2 text-right font-normal">Hit rate</th>
                  <th className="py-2 text-right font-normal">A-grade</th>
                  <th className="py-2 text-right font-normal">Avg R</th>
                  <th className="py-2 text-right font-normal">Net R</th>
                  <th className="py-2 text-right font-normal">Max drawdown</th>
                  <th className="py-2 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.symbol}-${r.timeframe}-${r.lookback}`} className="border-b border-border/50">
                    <td className="py-2 font-medium">{r.symbol}</td>
                    <td className="py-2 text-right font-mono">{r.trades}</td>
                    <td className="py-2 text-right font-mono">{r.trades ? `${r.winRate}%` : "-"}</td>
                    <td className="py-2 text-right font-mono">{r.aTrades ? `${r.aWinRate}% (${r.aTrades})` : "-"}</td>
                    <td
                      className={`py-2 text-right font-mono ${r.expectancyR > 0 ? "text-emerald-400" : r.expectancyR < 0 ? "text-red-400" : ""}`}
                    >
                      {r.trades ? `${r.expectancyR}R` : "-"}
                    </td>
                    <td className="py-2 text-right font-mono">{r.trades ? `${r.netR}R` : "-"}</td>
                    <td className="py-2 text-right font-mono">{r.trades ? `${r.maxDdPct}%` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totals.updatedAt && (
            <p className="mt-3 text-xs text-muted-foreground">
              Last tested {new Date(totals.updatedAt).toLocaleString()}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
