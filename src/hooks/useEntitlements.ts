import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { consumeGrade, getEntitlements, type EntitlementSnapshot } from "@/lib/entitlements.functions";
import { can, quotaView, type Capability, type ScanOutcome } from "@/lib/entitlements";

const QUERY_KEY = ["entitlements"] as const;

/**
 * One hook every gated surface reads, so quota, paywall and preview states can't
 * disagree with each other. While loading we assume full access: a paying user
 * must never see a flash of the paywall.
 */
export function useEntitlements() {
  const fetchEntitlements = useServerFn(getEntitlements);
  const charge = useServerFn(consumeGrade);
  const qc = useQueryClient();

  const query = useQuery<EntitlementSnapshot>({
    queryKey: QUERY_KEY,
    queryFn: () => fetchEntitlements(),
    staleTime: 60_000,
    retry: 1,
  });

  const snap = query.data;
  const loading = query.isLoading;

  const allow = useCallback(
    (capability: Capability) => (snap ? can(snap.entitlements, capability) : true),
    [snap],
  );

  const recordScanOutcome = useCallback(
    async (outcome: ScanOutcome["kind"], scan?: { symbol: string; timeframe: string; methodology?: string }) => {
      if (snap && !snap.entitlements.freeTierActive) return;
      try {
        const res = await charge({ data: { outcome, ...scan } });
        if (res?.quota) {
          qc.setQueryData<EntitlementSnapshot>(QUERY_KEY, (prev) => (prev ? { ...prev, quota: res.quota } : prev));
        }
      } catch {
        // Never let accounting break a delivered scan; refresh instead.
        void qc.invalidateQueries({ queryKey: QUERY_KEY });
      }
    },
    [charge, qc, snap],
  );

  const quota = snap?.quota ?? quotaView(
    { freeTierActive: false, gradeLimit: null } as never,
    0,
  );

  return {
    loading,
    snapshot: snap,
    tier: snap?.entitlements.tier ?? "elite",
    isFree: !!snap?.entitlements.freeTierActive,
    isPaid: snap ? snap.entitlements.isPaid : true,
    onLegacyTrial: !!snap?.entitlements.onLegacyTrial,
    coachAllowance: snap?.entitlements.coachAllowance ?? 5,
    journalledTrades: snap?.journalledTrades ?? 0,
    quota,
    /** Free user with 0 left — the next grade attempt should open the paywall. */
    gradesExhausted: !!snap?.quota.active && snap.quota.exhausted,
    allow,
    recordScanOutcome,
    refresh: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  };
}
