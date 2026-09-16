// Per-instrument measured edge (Phase 4, item 11).
//
// Two independent measurements per symbol, side by side:
//  - hit rate and expectancy from resolved scans (real bars, not self-reported)
//  - the instrument's measured behaviour that tunes the engine constants
// Anything with too few resolved scans is labelled as such instead of quoted.

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3, Info } from "lucide-react";
import { getSignalScoreboard } from "@/lib/signal-scores.functions";
import { getInstrumentProfiles } from "@/lib/instrument-profile.functions";
import { InfoTip } from "@/components/InfoTip";
import { SESSION_LABEL, type SessionKey } from "@/lib/instrument-profile.shared";
import { engineSymbolFor } from "@/lib/agents/biasEngine";
import { behaviourFor, expectedHold } from "@/lib/instrumentBehaviour";

const MIN_RESOLVED = 5;

export function InstrumentEdgePanel() {
  const loadScores = useServerFn(getSignalScoreboard);
  const loadProfiles = useServerFn(getInstrumentProfiles);

  const scores = useQuery({
    queryKey: ["signal-scoreboard", "by-symbol"],
    queryFn: () => loadScores(),
    staleTime: 60_000,
  });
  const profiles = useQuery({
    queryKey: ["instrument-profiles"],
    queryFn: () => loadProfiles(),
    staleTime: 10 * 60_000,
  });

  const buckets = scores.data?.scoreboard?.bySymbol ?? [];
  const profileMap = new Map((profiles.data?.profiles ?? []).map((p) => [p.symbol, p]));

  // Buckets are keyed by display ticker ("XAU/USD"), profiles by engine symbol
  // ("XAU_USD"). Merge on the engine symbol so a symbol never lists twice.
  type Row = { key: string; label: string; bucket: (typeof buckets)[number] | null; profile: ReturnType<typeof profileMap.get> | null };
  const byEngine = new Map<string, Row>();
  const put = (key: string, label: string) => {
    const engine = engineSymbolFor(key);
    const existing = byEngine.get(engine);
    const bucket = buckets.find((b) => engineSymbolFor(b.key) === engine) ?? null;
    const profile = profileMap.get(engine) ?? null;
    if (existing) {
      if (!existing.label.includes("/") && label.includes("/")) existing.label = label;
      existing.bucket = existing.bucket ?? bucket;
      existing.profile = existing.profile ?? profile;
      return;
    }
    byEngine.set(engine, { key: engine, label, bucket, profile });
  };
  for (const b of buckets) put(b.key, b.key);
  for (const sym of profileMap.keys()) put(sym, sym);

  const rows = [...byEngine.values()].sort(
    (a, b) => (b.bucket?.resolved ?? 0) - (a.bucket?.resolved ?? 0) || a.label.localeCompare(b.label),
  );

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
        <BarChart3 className="h-4 w-4" /> Edge by instrument
        <span className="font-normal text-muted-foreground">
          measured per symbol, not blended
        </span>
        <InfoTip id="hitRate" />
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {scores.isLoading || profiles.isLoading
            ? "Loading measured numbers…"
            : "No resolved scans yet. Numbers appear here once scans have run forward against real bars."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60 text-left">
                <th className="px-4 py-2 font-medium">Instrument</th>
                <th className="px-3 py-2 font-medium">Hit rate</th>
                <th className="px-3 py-2 font-medium">Expectancy</th>
                <th className="px-3 py-2 font-medium">Resolved</th>
                <th className="px-3 py-2 font-medium">Volatility (ATR)</th>
                <th className="px-3 py-2 font-medium">Typical pullback</th>
                <th className="px-3 py-2 font-medium">Busiest session</th>
                <th className="px-3 py-2 font-medium">Trades in</th>
                <th className="px-3 py-2 font-medium">Typical hold</th>
                <th className="px-3 py-2 font-medium">Max grade</th>
                <th className="px-3 py-2 font-medium">Tuning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ key, label, bucket, profile }) => {
                const enough = (bucket?.resolved ?? 0) >= MIN_RESOLVED;
                const exp = bucket?.expectancyR ?? 0;
                const behaviour = behaviourFor(key, profile ? { bestSession: profile.bestSession as SessionKey, barsSampled: profile.barsSampled } : null);
                const hold = expectedHold(behaviour);
                return (
                  <tr key={key}>
                    <td className="px-4 py-2 font-semibold">{label.replace(/_/g, "/")}</td>
                    <td className="px-3 py-2 font-mono">
                      {enough ? `${bucket!.hitRate.toFixed(0)}%` : <span className="text-muted-foreground">too few</span>}
                    </td>
                    <td className={`px-3 py-2 font-mono ${enough ? (exp >= 0 ? "text-bull" : "text-red-500") : ""}`}>
                      {enough ? `${exp >= 0 ? "+" : ""}${exp.toFixed(2)}R` : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{bucket?.resolved ?? 0}</td>
                    <td className="px-3 py-2 font-mono">
                      {profile ? `${profile.atrPct.toFixed(2)}%` : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {profile ? `${(profile.medianPullback * 100).toFixed(0)}% / ${(profile.deepPullback * 100).toFixed(0)}% deep` : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2">
                      {profile ? SESSION_LABEL[profile.bestSession as SessionKey] ?? profile.bestSession : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2">
                      {behaviour.continuous
                        ? "24/7"
                        : behaviour.activeSessions.map((sess) => SESSION_LABEL[sess]).join(", ")}
                    </td>
                    <td className="px-3 py-2">{hold.label}</td>
                    <td className="px-3 py-2 font-mono">{behaviour.gradeCeiling}</td>
                    <td className="px-3 py-2">
                      {profile?.tuned ? (
                        <span className="inline-flex items-center gap-1 rounded border border-bull/50 px-1.5 py-0.5 font-semibold text-bull" title={profile.tuneReason}>
                          Tuned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground" title="Not enough measured history, so this symbol uses the conservative default settings.">
                          Default
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Hit rate and expectancy come from scans resolved against real price bars. Volatility and pullback depth are measured
          from years of 4H history and set the entry and stop distances used for that symbol. Symbols marked Default have not
          been measured yet and run on conservative settings. Trades in, typical hold and max grade are that market's own behaviour:
          a setup found outside its session is graded down, and a market only earns top grades once its measured results justify them.
        </span>
      </div>
    </div>
  );
}
