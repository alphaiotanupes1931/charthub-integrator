import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList } from "lucide-react";
import { listScanLog, type ScanLogRow } from "@/lib/scan-log.functions";

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_LABEL: Record<string, string> = {
  open: "Watching",
  no_trade: "No trade",
  tp1: "Hit target",
  win: "Hit target",
  stopped: "Stopped",
  loss: "Stopped",
  expired: "Expired",
  unfilled: "Never filled",
  void: "No trade",
};

function fmt(v: number | null) {
  if (v == null) return "—";
  const d = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 10 ? 3 : 5;
  return v.toFixed(d);
}

export function DailyScanLog() {
  const [day, setDay] = useState(today());
  const fetchLog = useServerFn(listScanLog);
  const q = useQuery({ queryKey: ["scan-log", day], queryFn: () => fetchLog({ data: { day } }) });
  const rows: ScanLogRow[] = q.data ?? [];
  const settled = rows.filter((r) => r.realized_r != null);
  const totalR = settled.reduce((a, r) => a + (r.realized_r ?? 0), 0);

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ClipboardList className="h-4 w-4" /> Daily scan log
          <span className="font-normal text-muted-foreground">
            ({rows.length} scans{settled.length ? `, ${settled.length} settled, ${totalR >= 0 ? "+" : ""}${totalR.toFixed(2)}R` : ""})
          </span>
        </div>
        <input
          type="date"
          value={day}
          max={today()}
          onChange={(e) => setDay(e.target.value || today())}
          className="rounded-lg border border-border/60 bg-background px-2 py-1 text-xs"
        />
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Every scan from the dashboard and the signal engine, saved to your account with the price feed it used. Outcomes fill in hourly once price has had time to move. Dates are UTC.
      </p>
      {q.isLoading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No scans recorded for this day.</div>
      ) : (
        <div className="overflow-x-auto p-2">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                {["Time", "Market", "TF", "Call", "Grade", "Entry", "Stop", "Target", "Feed", "Outcome", "R", "Taken"].map((h) => (
                  <th key={h} className="px-2 py-1 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="px-2 py-1">{new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-2 py-1 font-semibold">{r.symbol}</td>
                  <td className="px-2 py-1">{r.timeframe}</td>
                  <td className={`px-2 py-1 ${r.bias === "Long" ? "text-bull" : r.bias === "Short" ? "text-destructive" : "text-muted-foreground"}`}>{r.bias}</td>
                  <td className="px-2 py-1">{r.grade}</td>
                  <td className="px-2 py-1">{fmt(r.entry)}</td>
                  <td className="px-2 py-1">{fmt(r.stop)}</td>
                  <td className="px-2 py-1">{fmt(r.tp1)}</td>
                  <td className="px-2 py-1">{r.data_feed ?? "—"}</td>
                  <td className="px-2 py-1" title={r.refused_reason ?? undefined}>
                    {STATUS_LABEL[r.status] ?? r.status}
                    {r.refused_reason ? " (not scored)" : ""}
                  </td>
                  <td className="px-2 py-1">{r.realized_r == null ? "—" : `${r.realized_r >= 0 ? "+" : ""}${r.realized_r.toFixed(2)}`}</td>
                  <td className="px-2 py-1">{r.taken ? "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
