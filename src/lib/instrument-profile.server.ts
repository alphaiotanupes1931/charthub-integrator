// Server side of the per-instrument profile: measure from history bars, persist,
// and read back for the scan engine.

import { getHistory } from "./backtest/history.server";
import { BACKTEST_SYMBOLS } from "./backtest/catalog";
import {
  profileFromBars,
  tunedConfig,
  type InstrumentProfile,
  type SessionKey,
  type SessionStat,
} from "./instrument-profile.shared";
import { engineSymbolFor, getInstrumentConfig, type InstrumentConfig } from "./agents/biasEngine";

export type StoredProfile = InstrumentProfile & {
  /** Display ticker the profile was measured on ("XAU/USD"). */
  ticker: string;
  tuned: boolean;
  tuneReason: string;
  cfg: InstrumentConfig;
  source: string;
};

/** Every symbol we can measure. Backtest catalog covers the instruments with history. */
export const PROFILE_SYMBOLS: string[] = [...BACKTEST_SYMBOLS];

export async function measureInstrument(ticker: string, lookback = "2y"): Promise<StoredProfile> {
  const { bars, source } = await getHistory(ticker, "240", lookback);
  // Session character needs 1H granularity; a 4H bucket straddles two sessions.
  let hourly: typeof bars = [];
  try {
    hourly = (await getHistory(ticker, "60", "6mo")).bars;
  } catch {
    hourly = [];
  }
  const engineSymbol = engineSymbolFor(ticker);
  const profile = profileFromBars(engineSymbol, bars, lookback, hourly);
  const { cfg: base } = getInstrumentConfig(ticker);
  const { cfg, tuned, reason } = tunedConfig(base, profile);
  return { ...profile, ticker, tuned, tuneReason: reason, cfg, source };
}

type Row = {
  symbol: string;
  bars_sampled: number;
  lookback: string;
  atr_4h: number | string;
  atr_pct: number | string;
  median_pullback: number | string;
  deep_pullback: number | string;
  best_session: string;
  sessions: unknown;
  entry_buffer: number | string | null;
  stop_buffer_atr: number | string | null;
  max_entry_distance_atr: number | string | null;
  min_rr: number | string | null;
  tuned: boolean;
  tune_reason: string | null;
  source: string | null;
  measured_at: string;
};

const num = (v: number | string | null | undefined, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n as number) ? (n as number) : fallback;
};

function rowToProfile(row: Row): StoredProfile {
  const symbol = row.symbol;
  const { cfg: base } = getInstrumentConfig(symbol);
  const cfg: InstrumentConfig = {
    ...base,
    entryBuffer: num(row.entry_buffer, base.entryBuffer),
    stopBufferAtr: num(row.stop_buffer_atr, base.stopBufferAtr),
    maxEntryDistanceAtr: num(row.max_entry_distance_atr, base.maxEntryDistanceAtr),
    minRR: num(row.min_rr, base.minRR),
  };
  return {
    symbol,
    ticker: symbol,
    barsSampled: row.bars_sampled,
    lookback: row.lookback,
    atr4h: num(row.atr_4h),
    atrPct: num(row.atr_pct),
    medianPullback: num(row.median_pullback, 0.5),
    deepPullback: num(row.deep_pullback, 0.75),
    bestSession: (row.best_session as SessionKey) ?? "newyork",
    sessions: Array.isArray(row.sessions) ? (row.sessions as SessionStat[]) : [],
    measuredAt: row.measured_at,
    tuned: row.tuned,
    tuneReason: row.tune_reason ?? "",
    cfg,
    source: row.source ?? "",
  };
}

export async function saveProfiles(profiles: StoredProfile[]): Promise<void> {
  if (!profiles.length) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows = profiles.map((p) => ({
    symbol: p.symbol,
    bars_sampled: p.barsSampled,
    lookback: p.lookback,
    atr_4h: p.atr4h,
    atr_pct: p.atrPct,
    median_pullback: p.medianPullback,
    deep_pullback: p.deepPullback,
    best_session: p.bestSession,
    sessions: p.sessions,
    entry_buffer: p.cfg.entryBuffer,
    stop_buffer_atr: p.cfg.stopBufferAtr,
    max_entry_distance_atr: p.cfg.maxEntryDistanceAtr,
    min_rr: p.cfg.minRR,
    tuned: p.tuned,
    tune_reason: p.tuneReason,
    source: p.source,
    measured_at: p.measuredAt,
  }));
  const { error } = await (supabaseAdmin as any)
    .from("instrument_profiles")
    .upsert(rows, { onConflict: "symbol" });
  if (error) throw new Error(error.message);
}

export async function loadProfilesFromDb(): Promise<StoredProfile[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any)
    .from("instrument_profiles")
    .select("*")
    .order("symbol", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(rowToProfile);
}

// Scan-path cache. Profiles change once a day at most, so re-reading them on
// every scan would be wasted latency.
let cache: { at: number; map: Map<string, StoredProfile> } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function profileMap(): Promise<Map<string, StoredProfile>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  try {
    const rows = await loadProfilesFromDb();
    cache = { at: Date.now(), map: new Map(rows.map((r) => [r.symbol, r])) };
  } catch {
    cache = { at: Date.now(), map: new Map() };
  }
  return cache.map;
}

/** Config override for the bias engine, or null when the symbol has no tuned profile. */
export async function tunedConfigFor(ticker: string): Promise<InstrumentConfig | null> {
  const map = await profileMap();
  const p = map.get(engineSymbolFor(ticker));
  return p && p.tuned ? p.cfg : null;
}

export function invalidateProfileCache(): void {
  cache = null;
}
