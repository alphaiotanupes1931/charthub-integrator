import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw, Target, XCircle, Clock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

import { getSignalScoreboard, resolveMySignalScores } from "@/lib/signal-scores.functions";
import { tfLabel, type ScoreBucket } from "@/lib/signal-scores.shared";

export const Route = createFileRoute("/_app/scoreboard")({
  head: () => ({
    meta: [
      { title: "Signal Scoreboard, TradeMind" },
      {
        name: "description",
        content:
          "Every scan the coach produced, resolved against real price bars, so you can see which instruments, grades and timeframes actually hit.",
      },
      { property: "og:title", content: "Signal Scoreboard, TradeMind" },
      {
        property: "og:description",
        content: "Measured hit rate and expectancy for every scan, broken down by grade, instrument, timeframe and strategy.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScoreboardPage,
});

/**
 * Every figure on this page carries the count it was computed from. That is not
 * decoration: hit rate and average R were once averaged over different sets, and
 * the only way to catch that class of bug is to print the n next to the number.
 */
function Stat({ label, value, n, sub }: { label: string; value: string; n?: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 p-4">
      <div className="text-xs tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {n != null && <div className="mt-0.5 font-mono text-xs text-muted-foreground">n = {n}</div>}
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function BucketTable({ title, buckets, empty }: { title: string; buckets: ScoreBucket[]; empty: string }) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-5">
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">{title}</h2>
      {buckets.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-3 font-normal">Group</th>
                <th className="py-2 pr-3 font-normal">Filed</th>
                <th className="py-2 pr-3 font-normal">Open</th>
                <th className="py-2 pr-3 font-normal">Decided (n)</th>
                <th className="py-2 pr-3 font-normal">Hit</th>
                <th className="py-2 pr-3 font-normal">Stopped</th>
                <th className="py-2 pr-3 font-normal">Expired</th>
                <th className="py-2 pr-3 font-normal">Hit rate</th>
                <th className="py-2 pr-3 font-normal">Avg R gross</th>
                <th className="py-2 pr-3 font-normal">Avg R net</th>
                <th className="py-2 font-normal">Heat / best (n)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {buckets.map((b) => (
                <tr key={b.key}>
                  <td className="py-2 pr-3 font-medium">{b.key}</td>
                  <td className="py-2 pr-3 font-mono">{b.total}</td>
                  <td className="py-2 pr-3 font-mono text-muted-foreground">{b.open}</td>
                  <td className="py-2 pr-3 font-mono">{b.decided}</td>
                  <td className="py-2 pr-3 font-mono text-emerald-400">{b.targets}</td>
                  <td className="py-2 pr-3 font-mono text-red-400">{b.stops}</td>
                  <td className="py-2 pr-3 font-mono text-muted-foreground">
                    {b.expired ? `${b.expired}${b.expiredAvgR == null ? "" : ` (${b.expiredAvgR}R)`}` : "-"}
                  </td>
                  <td className="py-2 pr-3 font-mono">{b.decided ? `${b.hitRate}%` : "-"}</td>
                  <td className={`py-2 pr-3 font-mono ${b.expectancyR > 0 ? "text-emerald-400" : b.expectancyR < 0 ? "text-red-400" : ""}`}>
                    {b.decided ? `${b.expectancyR}R` : "-"}
                  </td>
                  <td
                    className={`py-2 pr-3 font-mono ${
                      (b.netExpectancyR ?? 0) > 0 ? "text-emerald-400" : (b.netExpectancyR ?? 0) < 0 ? "text-red-400" : ""
                    }`}
                  >
                    {b.netExpectancyR == null ? "-" : `${b.netExpectancyR}R (n=${b.netCount})`}
                  </td>
                  {/* Heat taken and best price reached, recovered from the same bars
                      that decided the trade. Big best-price on a losing group means
                      the direction was right and the stop was too tight. */}
                  <td className="py-2 font-mono text-muted-foreground">
                    {b.avgMfeR == null ? "-" : `${b.avgMaeR}R / ${b.avgMfeR}R (n=${b.excursionCount})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ScoreboardPage() {
  const qc = useQueryClient();
  const load = useServerFn(getSignalScoreboard);
  const resolve = useServerFn(resolveMySignalScores);

  const query = useQuery({
    queryKey: ["signal-scoreboard"],
    queryFn: () => load(),
  });

  const resolveMutation = useMutation({
    mutationFn: () => resolve(),
    onSuccess: (res) => {
      if (res.resolved > 0) toast.success(`${res.resolved} signal${res.resolved === 1 ? "" : "s"} resolved.`);
      else if (res.checked === 0) toast.message("No open signals to check.");
      else toast.message("Checked open signals. None have reached a stop or target yet.");
      qc.invalidateQueries({ queryKey: ["signal-scoreboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const board = query.data?.scoreboard;
  const rows = query.data?.rows ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16">
      <PageHeader
        title="Signal scoreboard"
        description="Every scan is filed automatically and then checked against real price bars: did the stop or the first target print first? These numbers are measured, not remembered."
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => resolveMutation.mutate()}
          disabled={resolveMutation.isPending}
          className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-1.5 text-xs disabled:opacity-60"
        >
          <RefreshCw className={`h-3 w-3 ${resolveMutation.isPending ? "animate-spin" : ""}`} />
          {resolveMutation.isPending ? "Checking open signals" : "Check open signals now"}
        </button>
        <span className="text-xs text-muted-foreground">Open signals are also checked automatically on a schedule.</span>
      </div>

      {query.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading your scan record.</p>
      ) : !board || board.total === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No scans filed yet. Run a scan on the dashboard and it will be tracked here from that moment forward.
        </p>
      ) : (
        <>
          <p className="mt-4 rounded-xl border border-border/60 bg-card px-4 py-3 text-xs text-muted-foreground">
            One definition of resolved is used for every number here: <strong className="text-foreground">decided</strong>,
            meaning the stop or the first target actually printed. Expiries and open signals are counted on their own lines
            and never inside a hit rate or an average. Net R subtracts spread and slippage. Each figure shows the count it
            was computed from.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Signals filed"
              value={String(board.total)}
              n={board.total}
              sub={`${board.open} open, ${board.decided} decided, ${board.expired} expired${board.voided ? `, ${board.voided} no-direction (excluded)` : ""}`}
            />
            <Stat
              label="Hit rate, decided only"
              value={board.decided ? `${board.hitRate}%` : "-"}
              n={board.decided}
              sub={`${board.targets} hit target, ${board.stops} stopped`}
            />
            <Stat
              label="Average R, decided only"
              value={board.decided ? `${board.expectancyR}R gross` : "-"}
              n={board.decided}
              sub={
                board.netExpectancyR == null
                  ? "No cost figures recorded on these rows yet"
                  : `${board.netExpectancyR}R net after costs (n = ${board.netCount}, ${board.avgCostR ?? 0}R average cost)`
              }
            />
            <Stat
              label="A and A+ hit rate"
              value={board.aGrade.decided ? `${board.aGrade.hitRate}%` : "-"}
              n={board.aGrade.decided}
              sub={`${board.aGrade.expectancyR}R gross${board.aGrade.netExpectancyR == null ? "" : `, ${board.aGrade.netExpectancyR}R net`}. Same denominator as the A row in the grade table.`}
            />
            <Stat
              label="Expiries"
              value={String(board.expired)}
              n={board.expired}
              sub={
                board.expiredAvgR == null
                  ? "No signals have timed out yet"
                  : `${board.expiredAvgR}R average at the last close. Held out of hit rate and average R.`
              }
            />
            <Stat
              label="Taken vs skipped"
              value={
                board.takenHitRate == null && board.skippedHitRate == null
                  ? "-"
                  : `${board.takenHitRate ?? "-"}% / ${board.skippedHitRate ?? "-"}%`
              }
              sub="Hit rate on signals you took, then the ones you passed on. Decided only."
            />
          </div>


          {board.notes.length > 0 && (
            <section className="mt-4 rounded-xl border border-border/60 bg-card p-5">
              <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">What this says</h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {board.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-4 grid gap-4">
            <BucketTable title="By grade" buckets={board.byGrade} empty="No graded signals yet." />
            <BucketTable
              title="By grade, trades you actually took"
              buckets={board.takenByGrade}
              empty="None of your journaled trades are linked to a filed scan yet. Log a trade with the same instrument and direction as a scan and it will show up here."
            />
            <BucketTable title="By instrument" buckets={board.bySymbol} empty="No instruments yet." />
            <BucketTable title="By timeframe" buckets={board.byTimeframe} empty="No timeframes yet." />
            <BucketTable title="By confidence" buckets={board.byConfidence} empty="No confidence data yet." />
            <BucketTable
              title="Counter-trend vs with-trend"
              buckets={board.byTrendContext}
              empty="No trend context recorded yet."
            />
            <BucketTable
              title="By strategy"
              buckets={board.byStrategy}
              empty="No strategy attached to your scans yet. Pick a playbook in the dashboard top bar and it will be tracked here."
            />
          </div>


          <section className="mt-4 rounded-xl border border-border/60 bg-card p-5">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground">Recent signals</h2>
            <ul className="mt-3 divide-y divide-border">
              {rows.slice(0, 40).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <span className="w-20 font-semibold">{r.symbol}</span>
                  <span className="text-muted-foreground">{r.bias}</span>
                  <span className="rounded-xl border border-border/60 px-2 py-0.5">{r.grade}</span>
                  <span className="text-muted-foreground">{tfLabel(r.timeframe)}</span>
                  <span className="font-mono text-muted-foreground">@ {r.entry}</span>
                  {r.taken && <span className="rounded-xl border border-border/60 px-2 py-0.5 text-[10px]">Taken</span>}
                  {r.counterTrend && (
                    <span className="rounded-xl border border-amber-500/50 px-2 py-0.5 text-[10px] text-amber-400">
                      Counter-trend
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    {r.status === "target" && (
                      <>
                        <Target className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Hit target {r.realizedR}R</span>
                      </>
                    )}
                    {r.status === "stop" && (
                      <>
                        <XCircle className="h-3 w-3 text-red-400" />
                        <span className="text-red-400">Stopped -1R</span>
                      </>
                    )}
                    {r.status === "expired" && (
                      <>
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Expired {r.realizedR}R</span>
                      </>
                    )}
                    {r.status === "open" && <span className="text-muted-foreground">Open</span>}
                    {r.status === "void" && (
                      <span className="text-muted-foreground">Not scored (no direction)</span>
                    )}
                  </span>
                  <span className="ml-auto text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
