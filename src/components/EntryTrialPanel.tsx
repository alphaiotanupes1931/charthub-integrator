// Read-only: live entry vs the two trial entries, per instrument and per
// session phase. Trial results never change a live signal.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEntryTrialReport, getEntryCandidateReport, type EntryTrialRow } from "@/lib/signal-scores.functions";
import { InfoTip } from "@/components/InfoTip";

const MIN_SAMPLE = 30;

function avg(sum: number, n: number) {
  return n ? (sum / n).toFixed(2) : "-";
}

function Table({ title, rows }: { title: string; rows: EntryTrialRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="text-left">
              <th className="py-1 pr-3 font-normal"></th>
              <th className="py-1 pr-3 font-normal">Live (n / total R / avg)</th>
              <th className="py-1 pr-3 font-normal">Order block</th>
              <th className="py-1 pr-3 font-normal">Full sequence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border/40">
                <td className="py-1.5 pr-3 font-medium">{r.key}</td>
                <td className="py-1.5 pr-3">{r.trades} / {r.liveNetR} / {avg(r.liveNetR, r.trades)}</td>
                <td className={`py-1.5 pr-3 ${r.obTrades < MIN_SAMPLE ? "text-muted-foreground" : ""}`}>{r.obTrades} / {r.obNetR} / {avg(r.obNetR, r.obTrades)}</td>
                <td className={`py-1.5 pr-3 ${r.seqTrades < MIN_SAMPLE ? "text-muted-foreground" : ""}`}>{r.seqTrades} / {r.seqNetR} / {avg(r.seqNetR, r.seqTrades)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EntryTrialPanel() {
  const fetchReport = useServerFn(getEntryTrialReport);
  const { data, isLoading } = useQuery({ queryKey: ["entry-trial-report"], queryFn: () => fetchReport() });
  return (
    <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        Entry trials
        <InfoTip text={`Same signals, three entry rules: the live entry, the order-block trial, and the full session sequence. Results are net of costs and count only filled trades. Under ${MIN_SAMPLE} trades a column is too thin to trust and is dimmed. Trials never change live signals.`} />
      </h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !data?.total ? (
        <p className="text-sm text-muted-foreground">No finished trial trades yet. Results build up from new scans.</p>
      ) : (
        <>
          <Table title="All instruments" rows={[data.total]} />
          <Table title="By instrument" rows={data.bySymbol} />
          <Table title="By session phase at scan time" rows={data.bySessionPhase} />
        </>
      )}
      {data?.seqStatus.length ? (
        <div className="text-xs text-muted-foreground">
          Sequence step reached on scans: {data.seqStatus.map((s) => `${s.status} ${s.count}`).join(", ")}
        </div>
      ) : null}
      <CandidateSection />
    </div>
  );
}

const MODEL_LABEL: Record<string, string> = {
  broken_level: "Broken level (baseline)",
  order_block: "Order block",
  imbalance: "Imbalance",
  retracement_618_79: "0.618-0.79 band",
};

function CandidateSection() {
  const fetchCands = useServerFn(getEntryCandidateReport);
  const { data } = useQuery({ queryKey: ["entry-candidate-report"], queryFn: () => fetchCands() });
  const rows = data?.total ? [data.total, ...data.rows] : [];
  return (
    <div className="space-y-2 border-t border-border/40 pt-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        Four entry candidates off the same break
        <InfoTip text={`Equal risk and the same target for every candidate. Every armed setup counts; a level that never filled scores 0R. The broken level is the baseline the others must beat. Tiers: broken level B, the other three C (recorded only). Diff is how far the baseline sits from the live entry, in R.`} />
      </div>
      {!rows.length ? (
        <p className="text-xs text-muted-foreground">No finished armed setups yet. Results build up from new scans.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-3 font-normal"></th>
                {Object.values(MODEL_LABEL).map((l) => (
                  <th key={l} className="py-1 pr-3 font-normal">{l}</th>
                ))}
                <th className="py-1 pr-3 font-normal">Diff vs live</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className={`border-t border-border/40 ${r.armed < MIN_SAMPLE ? "text-muted-foreground" : ""}`}>
                  <td className="py-1.5 pr-3 font-medium">{r.symbol} ({r.armed})</td>
                  {Object.keys(MODEL_LABEL).map((m) => {
                    const c = r.candidates.find((x) => x.model === m);
                    return (
                      <td key={m} className="py-1.5 pr-3">
                        {c ? `${Math.round(c.fillRate * 100)}% fill / ${c.totalR}R / ${c.avgR}` : "-"}
                      </td>
                    );
                  })}
                  <td className="py-1.5 pr-3">{r.avgDiffR ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
