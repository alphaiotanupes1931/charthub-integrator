// Read and refresh per-instrument measured profiles.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProfileDto = {
  symbol: string;
  barsSampled: number;
  lookback: string;
  atr4h: number;
  atrPct: number;
  medianPullback: number;
  deepPullback: number;
  bestSession: string;
  tuned: boolean;
  tuneReason: string;
  entryBuffer: number;
  stopBufferAtr: number;
  maxEntryDistanceAtr: number;
  minRR: number;
  measuredAt: string;
};

export const getInstrumentProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ profiles: ProfileDto[] }> => {
    const { loadProfilesFromDb } = await import("./instrument-profile.server");
    try {
      const rows = await loadProfilesFromDb();
      return {
        profiles: rows.map((p) => ({
          symbol: p.symbol,
          barsSampled: p.barsSampled,
          lookback: p.lookback,
          atr4h: p.atr4h,
          atrPct: p.atrPct,
          medianPullback: p.medianPullback,
          deepPullback: p.deepPullback,
          bestSession: p.bestSession,
          tuned: p.tuned,
          tuneReason: p.tuneReason,
          entryBuffer: p.cfg.entryBuffer,
          stopBufferAtr: p.cfg.stopBufferAtr,
          maxEntryDistanceAtr: p.cfg.maxEntryDistanceAtr,
          minRR: p.cfg.minRR,
          measuredAt: p.measuredAt,
        })),
      };
    } catch {
      return { profiles: [] };
    }
  });

/** Admin-only: re-measure every supported instrument from real history bars. */
export const refreshInstrumentProfiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { symbols?: string[] } | undefined) => ({ symbols: input?.symbols ?? [] }))
  .handler(async ({ data, context }): Promise<{ measured: string[]; failed: Array<{ symbol: string; error: string }> }> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { measureInstrument, saveProfiles, invalidateProfileCache, PROFILE_SYMBOLS } =
      await import("./instrument-profile.server");

    const symbols = data.symbols.length ? data.symbols : PROFILE_SYMBOLS;
    const measured: string[] = [];
    const failed: Array<{ symbol: string; error: string }> = [];
    const batch: Awaited<ReturnType<typeof measureInstrument>>[] = [];

    for (const symbol of symbols) {
      try {
        const profile = await measureInstrument(symbol);
        batch.push(profile);
        measured.push(symbol);
      } catch (e) {
        failed.push({ symbol, error: (e as Error).message });
      }
    }

    if (batch.length) {
      await saveProfiles(batch);
      invalidateProfileCache();
    }
    return { measured, failed };
  });
