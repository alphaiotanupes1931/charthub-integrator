import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPlatformAccuracy } from "@/lib/platform-accuracy.functions";
import { measuredRate } from "@/lib/platform-accuracy.shared";
import { useEntitlements } from "@/hooks/useEntitlements";

/** Platform aggregates: scan outcomes and reported executed-trade P&L stay separate. */
export function TradeMindAccuracy() {
  const ent = useEntitlements();
  if (ent.loading || !ent.allow("signal_engine")) return null;
  return <MeasuredAccuracy />;
}

function MeasuredAccuracy() {
  const load = useServerFn(getPlatformAccuracy);
  const query = useQuery({ queryKey: ["platform-accuracy"], queryFn: () => load(), staleTime: 60_000, refetchInterval: 60_000, retry: false });
  const scans = query.data?.scans;
  const trades = query.data?.trades;
  const label = (wins: number, losses: number) => {
    const rate = measuredRate(wins, losses);
    return rate == null ? "No settled results" : `${rate}%`;
  };
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3 border-b border-border/60 text-xs" aria-label="TradeMind accuracy">
      <div className="font-semibold">TradeMind accuracy <span className="font-normal text-muted-foreground">· across all users</span></div>
      {query.isError ? <span className="text-muted-foreground">Results temporarily unavailable</span> : query.isPending ? <span className="text-muted-foreground">Loading results…</span> : <>
        {scans && <div title="Targets reached before stops in recorded scans after the planned entry was reached; open, expired, unfilled and correlated duplicate scans excluded.">
          <div className="font-semibold">Scan hit rate: <span className="text-primary tabular-nums">{label(scans.wins, scans.losses)}</span></div>
          <div className="text-muted-foreground">n={scans.wins + scans.losses} · {scans.wins} targets / {scans.losses} stops · price-bar outcomes</div>
        </div>}
        {trades && <div title="Closed executed journal trades with reported P&L. User-reported, not independently broker-verified; simulated outcomes excluded. Breakeven excluded from win rate.">
          <div className="font-semibold">Logged trade win rate: <span className="text-primary tabular-nums">{label(trades.wins, trades.losses)}</span></div>
          <div className="text-muted-foreground">n={trades.wins + trades.losses} · {trades.wins} wins / {trades.losses} losses{trades.breakeven ? ` · ${trades.breakeven} breakeven` : ""} · reported P&amp;L, not broker-verified</div>
        </div>}
      </>}
    </div>
  );
}