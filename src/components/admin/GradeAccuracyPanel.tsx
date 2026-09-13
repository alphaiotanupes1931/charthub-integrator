// Measured grade mix and per-grade win rate across the replay track record.
//
// Answers the calibration question with numbers: what share of setups land on
// A, B and C, and whether the higher grades actually win more often.
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BarChart3, CheckCircle2, HelpCircle } from "lucide-react";
import { listEngineReplay } from "@/lib/engine-replay.functions";
import type { ReplayRow } from "@/lib/engine-replay.shared";
import { gradeReport, VERDICT_LABEL, MIN_GRADE_TRADES } from "@/lib/grade-mix.shared";
import { InfoTip } from "@/components/InfoTip";

export function GradeAccuracyPanel() {
  const load = useServerFn(listEngineReplay);
  const [rows, setRows] = useState<ReplayRow[]>([]);

  useEffect(() => {
    load()
      .then(setRows)
      .catch(() => setRows([]));
  }, [load]);

  const report = useMemo(() => gradeReport(rows.map((r) => r.gradeMix)), [rows]);
  const perSymbol = useMemo(
    () =>
      rows
        .map((r) => ({ symbol: r.symbol, report: gradeReport([r.gradeMix]) }))
        .filter((r) => r.report.totalTrades > 0)
        .sort((a, b) => b.report.totalTrades - a.report.totalTrades),
    [rows],
  );

  const VerdictIcon =
    report.verdict === "calibrated" ? CheckCircle2 : report.verdict === "needs-attention" ? AlertTriangle : HelpCircle;
  const verdictTone =
    report.verdict === "calibrated"
      ? "text-emerald-500"
      : report.verdict === "needs-attention"
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <section className="mt-6 rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-start gap-2">
        <BarChart3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <h2 className="flex items-center gap-1 text-sm font-semibold">
            Grade accuracy and mix
            <InfoTip
              term="Grade mix"
              text="Every setup the replay test produced, sorted by the grade it was given. Shows what share of setups reach each grade and how each grade performed."
            />
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Measured on the stored replay results. Re-run the replay test above to refresh these numbers.
          </p>
        </div>
      </div>

      {report.totalTrades === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No graded setups measured yet. Run the replay test on all instruments first.
        </p>
      ) : (
        <>
          <div className={`mt-4 flex items-center gap-2 text-sm font-semibold ${verdictTone}`}>
            <VerdictIcon className="h-4 w-4" />
            {VERDICT_LABEL[report.verdict]}
            <span className="font-normal text-muted-foreground">
              · {report.totalTrades} setups measured, {report.aTrades} at A or better
            </span>
          </div>

          {report.issues.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {report.issues.map((issue) => (
                <li
                  key={issue.code}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    issue.severity === "alert"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "border-border/60 text-muted-foreground"
                  }`}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Grade</th>
                  <th className="py-2 pr-3 font-medium">Setups</th>
                  <th className="py-2 pr-3 font-medium">Share of all</th>
                  <th className="py-2 pr-3 font-medium">Win rate</th>
                  <th className="py-2 pr-3 font-medium">Average result</th>
                </tr>
              </thead>
              <tbody>
                {report.grades.map((g) => (
                  <tr key={g.grade} className="border-t border-border/50">
                    <td className="py-2 pr-3 font-semibold">{g.grade}</td>
                    <td className="py-2 pr-3">{g.trades}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="w-10 tabular-nums">{g.sharePct}%</span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${Math.min(100, g.sharePct)}%` }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {g.winRate == null ? "—" : `${g.winRate}%`}
                      {g.trades > 0 && g.trades < MIN_GRADE_TRADES && (
                        <span className="ml-1 text-muted-foreground">(thin)</span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${(g.expectancyR ?? 0) > 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
                      {g.expectancyR == null ? "—" : `${g.expectancyR}R`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
              Per instrument ({perSymbol.length})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Instrument</th>
                    <th className="py-2 pr-3 font-medium">A / B / C mix</th>
                    <th className="py-2 pr-3 font-medium">A win rate</th>
                    <th className="py-2 pr-3 font-medium">B win rate</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {perSymbol.map(({ symbol, report: r }) => {
                    const share = (k: "A+" | "A" | "B" | "C") => r.grades.find((g) => g.grade === k)?.sharePct ?? 0;
                    return (
                      <tr key={symbol} className="border-t border-border/50">
                        <td className="py-2 pr-3 font-medium">{symbol}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {Math.round(share("A+") + share("A"))}% / {Math.round(share("B"))}% / {Math.round(share("C"))}%
                        </td>
                        <td className="py-2 pr-3">{r.aWinRate == null ? "—" : `${r.aWinRate}%`}</td>
                        <td className="py-2 pr-3">{r.bWinRate == null ? "—" : `${r.bWinRate}%`}</td>
                        <td className="py-2 pr-3 text-muted-foreground">{VERDICT_LABEL[r.verdict]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
