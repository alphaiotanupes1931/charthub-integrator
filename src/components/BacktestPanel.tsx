// "Backtest and learn" panel: measures the trader's taken signals by grade,
// symbol, direction, timeframe and session, and lists the lessons the AI coach
// is also being told about.

import { useEffect, useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { listSignals, onSignalHistoryChange, type SignalRecord } from "@/lib/signalHistory";
import { buildLearningReport, type Bucket } from "@/lib/signalLearning";

function BucketTable({ title, rows }: { title: string; rows: Bucket[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="divide-y divide-border">
        {rows.slice(0, 6).map((b) => (
          <div key={b.key} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span className="font-medium">{b.key}</span>
            <span className="text-muted-foreground">{b.taken} trades</span>
            <span className="text-muted-foreground">{b.winRate}% WR</span>
            <span className={`font-mono font-semibold ${b.expectancyR > 0 ? "text-bull" : b.expectancyR < 0 ? "text-red-500" : "text-muted-foreground"}`}>
              {b.expectancyR > 0 ? "+" : ""}{b.expectancyR}R
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BacktestPanel() {
  const [records, setRecords] = useState<SignalRecord[]>([]);

  useEffect(() => {
    const sync = () => setRecords(listSignals());
    sync();
    return onSignalHistoryChange(sync);
  }, []);

  const report = useMemo(() => buildLearningReport(records), [records]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
        <FlaskConical className="h-4 w-4" /> Backtest and learn
        <span className="font-normal text-muted-foreground">({report.graded} graded of {report.taken} taken)</span>
        <Link to="/backtest" className="ml-auto text-xs font-normal text-primary underline-offset-2 hover:underline">
          Run a historical backtest
        </Link>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { l: "Win rate", v: `${report.winRate}%` },
            { l: "Expectancy", v: `${report.expectancyR > 0 ? "+" : ""}${report.expectancyR}R` },
            { l: "Wins / losses", v: `${report.wins}W / ${report.losses}L` },
            { l: "Breakeven", v: String(report.breakeven) },
          ].map((s) => (
            <div key={s.l} className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">{s.l}</div>
              <div className="mt-1 text-lg font-semibold">{s.v}</div>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What the coach has learned
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {report.lessons.map((l, i) => (
              <li key={i} className="text-muted-foreground">{l}</li>
            ))}
          </ul>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <BucketTable title="By grade" rows={report.byGrade} />
          <BucketTable title="By symbol" rows={report.bySymbol} />
          <BucketTable title="By direction" rows={report.byBias} />
          <BucketTable title="By timeframe" rows={report.byTimeframe} />
          <BucketTable title="By session (UTC)" rows={report.bySession} />
        </div>

        <p className="text-xs text-muted-foreground">
          Only signals you marked as taken and then tagged win, loss or breakeven are measured. The same
          numbers are sent to the coach so it warns you about buckets that keep losing.
        </p>
      </div>
    </div>
  );
}
