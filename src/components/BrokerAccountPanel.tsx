import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, RefreshCw, ShieldCheck } from "lucide-react";
import { getBrokerSnapshot } from "@/lib/broker-readonly.functions";
import { InfoTip } from "@/components/InfoTip";

/** Read-only view of the trader's live broker account: balance and open trades. */
export function BrokerAccountPanel({ className = "" }: { className?: string }) {
  const fetchSnapshot = useServerFn(getBrokerSnapshot);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["broker-snapshot"],
    queryFn: () => fetchSnapshot(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const money = (v: number | null | undefined, currency?: string | null) =>
    v == null ? "—" : `${v >= 0 ? "" : "-"}${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;

  return (
    <section className={`rounded-2xl border border-border/60 bg-card/60 p-4 sm:p-5 ${className}`}>
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Live account</h2>
        <InfoTip term="Read-only link" text="We can see your balance, open positions and recent closes. We cannot place, change or close orders from here." />
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[10px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" /> Read-only
        </span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition"
          aria-label="Refresh account"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!data ? (
        <p className="mt-3 text-xs text-muted-foreground">Checking your linked broker…</p>
      ) : !data.connected ? (
        <p className="mt-3 text-xs text-muted-foreground">{data.reason}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {data.snapshots.map((s) => (
            <div key={`${s.broker}-${s.accountId}`} className="rounded-xl border border-border/50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold uppercase tracking-wide">{s.broker}</span>
                <span className="rounded-full bg-accent/60 px-2 py-0.5 text-[10px] text-muted-foreground">{s.env}</span>
                {s.accountId && <span className="text-muted-foreground">#{s.accountId}</span>}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <Stat label="Balance" value={money(s.balance, s.currency)} />
                <Stat label="Equity" value={money(s.equity, s.currency)} />
                <Stat label="Open P&L" value={money(s.unrealizedPL, s.currency)} tone={(s.unrealizedPL ?? 0) >= 0 ? "up" : "down"} />
              </div>

              <div className="mt-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Open positions</div>
                {s.positions.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Flat right now.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {s.positions.map((p, i) => (
                      <li key={`${p.symbol}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className={`font-semibold ${p.side === "long" ? "text-bull" : "text-bear"}`}>
                          {p.side.toUpperCase()}
                        </span>
                        <span className="font-medium">{p.symbol}</span>
                        <span className="text-muted-foreground">{p.units} @ {p.entry}</span>
                        <span className="text-muted-foreground">SL {p.stopLoss ?? "none"}</span>
                        <span className="text-muted-foreground">TP {p.takeProfit ?? "none"}</span>
                        <span className={p.unrealizedPL >= 0 ? "text-bull" : "text-bear"}>{money(p.unrealizedPL)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {s.recentCloses.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Recent closes</div>
                  <ul className="mt-2 space-y-1.5">
                    {s.recentCloses.slice(0, 5).map((c, i) => (
                      <li key={`${c.symbol}-${i}`} className="flex flex-wrap items-center gap-x-3 text-xs">
                        <span className="font-medium">{c.symbol}</span>
                        <span className="text-muted-foreground">{c.side} {c.units} @ {c.price}</span>
                        <span className={c.realizedPL >= 0 ? "text-bull" : "text-bear"}>{money(c.realizedPL)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">
            Your coach reads these positions, so trade-management answers already know your side, size and stop.
          </p>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-lg bg-background/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${tone === "up" ? "text-bull" : tone === "down" ? "text-bear" : ""}`}>{value}</div>
    </div>
  );
}
