import { useSignalOutcomes } from "@/hooks/useSignalOutcomes";
import { InfoTip } from "@/components/InfoTip";
import { useEntitlements } from "@/hooks/useEntitlements";

/** Same measured hit rate and denominator as Signal History; not AI confidence. */
export function TradeMindAccuracy() {
  const ent = useEntitlements();
  if (ent.loading || !ent.allow("signal_engine")) return null;
  return <MeasuredAccuracy />;
}

function MeasuredAccuracy() {
  const { totals, loading } = useSignalOutcomes();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-border/60 text-xs" aria-label="TradeMind accuracy">
      <span className="inline-flex items-center gap-1 font-semibold">
        TradeMind accuracy:
        <span className="text-primary tabular-nums">{loading ? "Loading…" : totals.hitRate == null ? "Not enough results" : `${totals.hitRate}%`}</span>
        <InfoTip id="hitRate" />
      </span>
      {!loading && <span className="text-muted-foreground tabular-nums">{totals.decided} decided scans · {totals.targets} targets / {totals.stops} stops · your latest 500 recorded scans, all instruments</span>}
    </div>
  );
}