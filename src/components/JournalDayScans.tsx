import { useEffect, useState } from "react";
import { getJournalDay } from "@/lib/journal-day.functions";

type DayData = Awaited<ReturnType<typeof getJournalDay>>;

function outcomeLabel(status: string | null, r: number | null): string {
  if (!status || status === "open" || status === "pending") return "Still tracking";
  const rTxt = r == null ? "" : ` (${r > 0 ? "+" : ""}${r.toFixed(2)}R)`;
  if (status === "target" || status === "tp") return `Hit target${rTxt}`;
  if (status === "stop" || status === "loss") return `Hit stop${rTxt}`;
  if (status === "expired" || status === "unfilled") return "Never filled";
  if (status === "void") return "Cancelled";
  return `${status}${rTxt}`;
}

/** Every scan run on this day: taken vs skipped and what happened after. */
export function JournalDayScans({ date }: { date: string }) {
  const [data, setData] = useState<DayData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    getJournalDay({ data: { date } })
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [date]);

  const taken = data?.scans.filter((s) => s.taken).length ?? 0;
  const skipped = (data?.scans.length ?? 0) - taken;

  return (
    <div className="border-t border-border/60">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="text-sm font-semibold">Scans this day</div>
        {data && (
          <div className="text-[11px] text-muted-foreground">
            {data.scans.length} scans · {taken} taken · {skipped} skipped
          </div>
        )}
      </div>
      {failed && <div className="px-4 pb-4 text-xs text-muted-foreground">Couldn't load this day's scans.</div>}
      {!data && !failed && <div className="px-4 pb-4 text-xs text-muted-foreground">Loading scans...</div>}
      {data && data.scans.length === 0 && (
        <div className="px-4 pb-4 text-xs text-muted-foreground">No scans were run on this day.</div>
      )}
      {data && data.scans.length > 0 && (
        <div className="divide-y divide-border/60">
          {data.scans.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{s.symbol}</span>
                  {s.grade && <span className="text-[10px] rounded bg-muted/40 px-1.5 py-0.5 text-muted-foreground">Grade {s.grade}</span>}
                  {s.bias && <span className="text-[11px] text-muted-foreground">{s.bias}</span>}
                  {s.timeframe && <span className="text-[10px] rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground">{s.timeframe}</span>}
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                  {s.entry != null ? `Entry ${s.entry}` : ""}{s.stop != null ? ` · Stop ${s.stop}` : ""}{s.tp1 != null ? ` · TP ${s.tp1}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`text-[11px] font-medium ${s.taken ? "text-primary" : "text-muted-foreground"}`}>
                  {s.taken ? "Taken" : "Skipped"}
                </div>
                <div className="text-[11px] text-muted-foreground">{outcomeLabel(s.status, s.realizedR)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && data.chats.length > 0 && (
        <div className="px-4 py-3 text-[11px] text-muted-foreground">
          Coach chats this day: {data.chats.map((c) => c.title).join(", ")}
        </div>
      )}
    </div>
  );
}
