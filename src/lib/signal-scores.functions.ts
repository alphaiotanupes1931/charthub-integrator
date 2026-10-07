// Signal quality scoreboard: file every scan, resolve it against real bars,
// and report where the coach's calls actually work.
import { createServerFn } from "@tanstack/react-start";
import { requireCapability } from "@/lib/capability-middleware";
import { z } from "zod";
import {
  buildScoreboard,
  type Scoreboard,
  type SignalScoreRow,
  type SignalScoreStatus,
} from "@/lib/signal-scores.shared";
import { SCANNER_METHODOLOGY_VERSION } from "@/lib/scanner-methodology";

const RecordInput = z.object({
  symbol: z.string().min(1).max(24),
  timeframe: z.string().min(1).max(4),
  grade: z.string().min(1).max(8),
  // Only directional scans can be scored, so Neutral cannot be filed with an
  // entry, stop and target at all.
  bias: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.enum(["long", "short"]))
    .transform((v) => (v === "long" ? "Long" : "Short")),
  confidence: z.number().min(0).max(100).nullable().optional(),
  strategyId: z.string().max(64).nullable().optional(),
  entry: z.number().finite(),
  stop: z.number().finite(),
  tp1: z.number().finite(),
  counterTrend: z.boolean().optional(),
  htfBias: z.string().max(12).nullable().optional(),
  methodologyVersion: z.string().min(1).max(40).optional(),
  /** Market price the plan was measured against. Required for the staleness guard. */
  lastPrice: z.number().finite().nullable().optional(),
  obShadowEntry: z.number().finite().nullable().optional(),
  obShadowStop: z.number().finite().nullable().optional(),
  obShadowLabel: z.string().max(80).nullable().optional(),
  seqShadowEntry: z.number().finite().nullable().optional(),
  seqShadowStop: z.number().finite().nullable().optional(),
  seqShadowTarget: z.number().finite().nullable().optional(),
  seqShadowStatus: z.string().max(40).nullable().optional(),
  seqShadowLabel: z.string().max(120).nullable().optional(),
  seqSessionPhase: z.string().max(40).nullable().optional(),
  seqH1Phase: z.string().max(40).nullable().optional(),
  entryModel: z.enum(["legacy", "order_block", "imbalance", "broken_level", "retracement_618_79"]).optional(),
  entryCandidates: z
    .object({
      version: z.string().max(40),
      state: z.string().max(20),
      direction: z.enum(["long", "short"]).nullable(),
      breakTime: z.number().nullable(),
      breakLevel: z.number().finite().nullable(),
      risk: z.number().finite().nullable(),
      target: z.number().finite().nullable(),
      levels: z.record(z.string().max(30), z.number().finite()),
    })
    .nullable()
    .optional(),
});

type Row = {
  id: string;
  symbol: string;
  timeframe: string;
  grade: string;
  bias: string;
  confidence: number | string | null;
  strategy_id: string | null;
  entry: number | string;
  stop: number | string;
  tp1: number | string;
  planned_r: number | string | null;
  status: string;
  realized_r: number | string | null;
  resolved_at: string | null;
  taken: boolean;
  created_at: string;
  counter_trend: boolean | null;
  htf_bias: string | null;
  net_r: number | string | null;
  cost_r: number | string | null;
  mae_r?: number | string | null;
  mfe_r?: number | string | null;
  rescued?: boolean | null;
  correlated?: boolean | null;
  correlation_cluster?: string | null;
  model_id?: string | null;
  model_version?: string | null;
};

function toRow(r: Row): SignalScoreRow {
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe,
    grade: r.grade,
    bias: r.bias,
    confidence: num(r.confidence),
    strategyId: r.strategy_id,
    entry: Number(r.entry),
    stop: Number(r.stop),
    tp1: Number(r.tp1),
    plannedR: num(r.planned_r),
    status: r.status as SignalScoreStatus,
    realizedR: num(r.realized_r),
    resolvedAt: r.resolved_at,
    taken: r.taken,
    createdAt: r.created_at,
    counterTrend: Boolean(r.counter_trend),
    htfBias: r.htf_bias,
    netR: num(r.net_r ?? null),
    costR: num(r.cost_r ?? null),
    maeR: num(r.mae_r ?? null),
    mfeR: num(r.mfe_r ?? null),
    rescued: Boolean(r.rescued),
    correlated: Boolean(r.correlated),
    correlationCluster: r.correlation_cluster ?? null,
    modelId: r.model_id ?? "classic",
    modelVersion: r.model_version ?? null,
  };
}

/** File a scan result. Duplicate scans of the same symbol/level inside 10 minutes are ignored. */
export const recordSignalScore = createServerFn({ method: "POST" })
  .middleware([requireCapability("signal_engine")])
  .inputValidator((raw: unknown) => RecordInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean; id?: string; refused?: string }> => {
    const risk = Math.abs(data.entry - data.stop);
    if (!risk) return { ok: false };

    // Which named analysis model produced this signal. Read from the account so
    // the stamp cannot be spoofed by the caller, and refuse outright while the
    // chosen model has no strategies written into it.
    const { getAnalysisModel, normalizeAnalysisModel } = await import("@/lib/analysis-models");
    const { data: profileRow } = await context.supabase
      .from("profiles")
      .select("analysis_model")
      .eq("id", context.userId)
      .maybeSingle();
    const model = getAnalysisModel(
      normalizeAnalysisModel((profileRow as { analysis_model?: string } | null)?.analysis_model),
    );
    if (!model.ready) {
      return { ok: false, refused: model.notReadyReason ?? `${model.name} has no strategies yet.` };
    }

    // Staleness guard. A signal whose entry price has already run away is not a
    // call, it is a report, so it never enters the record. The refusal is returned
    // rather than swallowed, so the drop in volume is visible.
    const { evaluateEntryStaleness } = await import("@/lib/signal-staleness");
    const staleness = evaluateEntryStaleness({
      bias: data.bias,
      entry: data.entry,
      stop: data.stop,
      lastPrice: data.lastPrice ?? null,
    });
    if (staleness.stale) return { ok: false, refused: staleness.reason ?? "Entry already gone." };

    if (data.bias === "Long" || data.bias === "Short") {
      const { checkSignalGeometry } = await import("@/lib/signal-geometry");
      const geo = checkSignalGeometry({ ...data, lastPrice: data.lastPrice ?? null });
      if (!geo.ok) return { ok: false, refused: geo.reason };
    }


    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: dupe } = await context.supabase
      .from("signal_scores")
      .select("id")
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol)
      .eq("timeframe", data.timeframe)
      .eq("bias", data.bias)
      .gte("created_at", since)
      .limit(1);
    if (dupe && dupe.length) return { ok: true, id: (dupe[0] as { id: string }).id };

    // Correlated instruments scanned in the same pass are one bet. The signal is
    // still filed, but flagged so the scoreboard counts the family once instead
    // of reporting the index complex as three independent calls.
    const { clusterOf, isCorrelatedDuplicate, CLUSTER_WINDOW_MINUTES } = await import(
      "@/lib/correlation-clusters"
    );
    const cluster = clusterOf(data.symbol);
    let correlated = false;
    if (cluster) {
      const { data: peerRows } = await context.supabase
        .from("signal_scores")
        .select("symbol, grade, bias, created_at")
        .eq("user_id", context.userId)
        .eq("correlation_cluster", cluster)
        .gte("created_at", new Date(Date.now() - CLUSTER_WINDOW_MINUTES * 60_000).toISOString())
        .limit(20);
      const peers = ((peerRows ?? []) as Array<{ symbol: string; grade: string; bias: string; created_at: string }>)
        .map((p) => ({ symbol: p.symbol, grade: p.grade, bias: p.bias, createdAt: p.created_at }));
      correlated = isCorrelatedDuplicate(
        { symbol: data.symbol, grade: data.grade, bias: data.bias, createdAt: new Date().toISOString() },
        peers,
      );
    }

    const plannedR = Math.round((Math.abs(data.tp1 - data.entry) / risk) * 100) / 100;
    // The filing timestamp is set here, not by the database, because it is part of
    // the fingerprint that seals these terms as append-only.
    const createdAt = new Date().toISOString();
    const { signalFingerprint } = await import("@/lib/signal-integrity.server");
    const filedHash = signalFingerprint({
      symbol: data.symbol,
      timeframe: data.timeframe,
      bias: data.bias,
      grade: data.grade,
      entry: data.entry,
      stop: data.stop,
      tp1: data.tp1,
      createdAt,
    });
    const { data: inserted, error } = await context.supabase
      .from("signal_scores")
      .insert({
        user_id: context.userId,
        symbol: data.symbol,
        timeframe: data.timeframe,
        grade: data.grade,
        bias: data.bias,
        confidence: data.confidence ?? null,
        strategy_id: data.strategyId ?? null,
        entry: data.entry,
        stop: data.stop,
        tp1: data.tp1,
        planned_r: plannedR,
        counter_trend: data.counterTrend ?? false,
        htf_bias: data.htfBias ?? null,
        methodology_version: data.methodologyVersion ?? SCANNER_METHODOLOGY_VERSION,
        created_at: createdAt,
        filed_hash: filedHash,
        entry_distance_r: staleness.distanceR,
        ob_shadow_entry: data.obShadowEntry ?? null,
        ob_shadow_stop: data.obShadowStop ?? null,
        ob_shadow_label: data.obShadowLabel ?? null,
        seq_shadow_entry: data.seqShadowEntry ?? null,
        seq_shadow_stop: data.seqShadowStop ?? null,
        seq_shadow_target: data.seqShadowTarget ?? null,
        seq_shadow_status: data.seqShadowStatus ?? null,
        seq_shadow_label: data.seqShadowLabel ?? null,
        seq_session_phase: data.seqSessionPhase ?? null,
        seq_h1_phase: data.seqH1Phase ?? null,
        entry_model: data.entryModel ?? "legacy",
        entry_candidates: data.entryCandidates ?? null,
        // Shadow diff: how far the baseline candidate sits from the live entry, in R.
        entry_diff_r:
          data.entryCandidates?.risk && data.entryCandidates.levels.broken_level != null
            ? Math.round(((data.entryCandidates.levels.broken_level - data.entry) / data.entryCandidates.risk) * 1000) / 1000
            : null,
        model_id: model.id,
        model_version: model.version,
        correlation_cluster: cluster,
        correlated,
      } as never)
      .select("id")
      .single();
    if (error) return { ok: false };
    return { ok: true, id: (inserted as { id: string }).id };
  });

/** Mark that the trader actually took a filed signal. */
export const markSignalScoreTaken = createServerFn({ method: "POST" })
  .middleware([requireCapability("signal_engine")])
  .inputValidator((raw: unknown) => z.object({ symbol: z.string().min(1).max(24) }).parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { data: rows } = await context.supabase
      .from("signal_scores")
      .select("id")
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1);
    const id = rows?.length ? (rows[0] as { id: string }).id : null;
    if (!id) return { ok: false };
    await context.supabase.from("signal_scores").update({ taken: true }).eq("id", id);
    return { ok: true };
  });

export const listSignalScores = createServerFn({ method: "GET" })
  .middleware([requireCapability("signal_engine")])
  .handler(async ({ context }): Promise<SignalScoreRow[]> => {
    const { data, error } = await context.supabase
      .from("signal_scores")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Row[]).map(toRow);
  });

export const getSignalScoreboard = createServerFn({ method: "GET" })
  .middleware([requireCapability("signal_engine")])
  .handler(async ({ context }): Promise<{ scoreboard: Scoreboard; rows: SignalScoreRow[] }> => {
    const { data, error } = await context.supabase
      .from("signal_scores")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = ((data ?? []) as unknown as Row[]).map(toRow);
    return { scoreboard: buildScoreboard(rows), rows };
  });

/** Resolve this trader's open signals now (also runs on a schedule). */
export const resolveMySignalScores = createServerFn({ method: "POST" })
  .middleware([requireCapability("signal_engine")])
  .handler(async ({ context }): Promise<{ checked: number; resolved: number }> => {
    const { data } = await context.supabase
      .from("signal_scores")
      .select("id, symbol, timeframe, bias, entry, stop, tp1, created_at, ob_shadow_entry, ob_shadow_stop, seq_shadow_entry, seq_shadow_stop, seq_shadow_target, entry_candidates")
      .eq("user_id", context.userId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(40);
    const open = (data ?? []) as unknown as Array<{
      id: string;
      symbol: string;
      timeframe: string;
      bias: string;
      entry: number | string;
      stop: number | string;
      tp1: number | string;
      created_at: string;
      ob_shadow_entry: number | string | null;
      ob_shadow_stop: number | string | null;
      seq_shadow_entry?: number | string | null;
      seq_shadow_stop?: number | string | null;
      seq_shadow_target?: number | string | null;
      entry_candidates?: unknown;
    }>;
    if (!open.length) return { checked: 0, resolved: 0 };

    const { resolveSignal } = await import("@/lib/signal-scores.server");
    let resolved = 0;
    for (const sig of open) {
      const res = await resolveSignal({
        id: sig.id,
        symbol: sig.symbol,
        timeframe: sig.timeframe,
        bias: sig.bias,
        entry: Number(sig.entry),
        stop: Number(sig.stop),
        tp1: Number(sig.tp1),
        created_at: sig.created_at,
        ob_shadow_entry: sig.ob_shadow_entry == null ? null : Number(sig.ob_shadow_entry),
        ob_shadow_stop: sig.ob_shadow_stop == null ? null : Number(sig.ob_shadow_stop),
        seq_shadow_entry: sig.seq_shadow_entry == null ? null : Number(sig.seq_shadow_entry),
        seq_shadow_stop: sig.seq_shadow_stop == null ? null : Number(sig.seq_shadow_stop),
        seq_shadow_target: sig.seq_shadow_target == null ? null : Number(sig.seq_shadow_target),
        entry_candidates: (sig.entry_candidates ?? null) as never,
      });
      if (res.status === "open") continue;
      await context.supabase
        .from("signal_scores")
        .update({
          status: res.status,
          realized_r: res.realizedR,
          resolved_at: new Date().toISOString(),
          net_r: res.netR ?? null,
          cost_r: res.costR ?? null,
          mae_r: res.maeR ?? null,
          mfe_r: res.mfeR ?? null,
          bars_to_resolve: res.barsToResolve ?? null,
          rescued: res.rescued ?? false,
          shadow_tp1r_r: res.shadowTp1rR ?? null,
          ob_shadow_r: res.obShadowR ?? null,
          seq_shadow_r: res.seqShadowR ?? null,
          entry_candidate_r: res.candidateR ?? null,
        } as never)
        .eq("id", sig.id);
      resolved += 1;
    }
    return { checked: open.length, resolved };
  });

export type ShadowTp1rRow = {
  symbol: string;
  trades: number;
  actualNetR: number;
  shadowNetR: number;
  deltaR: number;
};

/**
 * Read-only review of the 1R-target idea: per instrument, what the book made
 * versus what it would have made with every target at exactly 1R. Shadow data
 * only; nothing here changes a live signal.
 */
export const getShadowTp1rReport = createServerFn({ method: "GET" })
  .middleware([requireCapability("signal_engine")])
  .handler(async ({ context }): Promise<{ rows: ShadowTp1rRow[]; total: ShadowTp1rRow | null }> => {
    const { data, error } = await context.supabase
      .from("signal_scores")
      .select("symbol, net_r, shadow_tp1r_r")
      .eq("user_id", context.userId)
      .in("status", ["target", "stop", "expired"])
      .not("shadow_tp1r_r", "is", null)
      .limit(2000);
    if (error) throw new Error(error.message);

    const bySymbol = new Map<string, { trades: number; actual: number; shadow: number }>();
    for (const r of data ?? []) {
      const actual = r.net_r == null ? 0 : Number(r.net_r);
      const shadow = Number(r.shadow_tp1r_r);
      const agg = bySymbol.get(r.symbol) ?? { trades: 0, actual: 0, shadow: 0 };
      agg.trades += 1;
      agg.actual += actual;
      agg.shadow += shadow;
      bySymbol.set(r.symbol, agg);
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    const rows: ShadowTp1rRow[] = [...bySymbol.entries()]
      .map(([symbol, a]) => ({
        symbol,
        trades: a.trades,
        actualNetR: round(a.actual),
        shadowNetR: round(a.shadow),
        deltaR: round(a.shadow - a.actual),
      }))
      .sort((x, y) => y.deltaR - x.deltaR);
    const total = rows.length
      ? {
          symbol: "ALL",
          trades: rows.reduce((s, r) => s + r.trades, 0),
          actualNetR: round(rows.reduce((s, r) => s + r.actualNetR, 0)),
          shadowNetR: round(rows.reduce((s, r) => s + r.shadowNetR, 0)),
          deltaR: round(rows.reduce((s, r) => s + r.deltaR, 0)),
        }
      : null;
    return { rows, total };
  });

export type EntryTrialRow = {
  key: string;
  trades: number;
  liveNetR: number;
  obTrades: number;
  obNetR: number;
  seqTrades: number;
  seqNetR: number;
};

export type EntryTrialReport = {
  bySymbol: EntryTrialRow[];
  bySessionPhase: EntryTrialRow[];
  seqStatus: Array<{ status: string; count: number }>;
  total: EntryTrialRow | null;
};

/**
 * Read-only comparison of the three entry rules on the same signals: the live
 * entry, the order-block trial and the full-sequence trial. Also splits results
 * by the session phase recorded at scan time. Nothing here changes a signal.
 */
export const getEntryTrialReport = createServerFn({ method: "GET" })
  .middleware([requireCapability("signal_engine")])
  .handler(async ({ context }): Promise<EntryTrialReport> => {
    const { data, error } = await context.supabase
      .from("signal_scores")
      .select("symbol, status, net_r, ob_shadow_r, seq_shadow_r, seq_shadow_status, seq_session_phase, ob_shadow_entry, seq_shadow_entry")
      .eq("user_id", context.userId)
      .or("ob_shadow_entry.not.is.null,seq_shadow_status.not.is.null")
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) throw new Error(error.message);
    const round = (n: number) => Math.round(n * 100) / 100;
    const blank = (key: string): EntryTrialRow => ({ key, trades: 0, liveNetR: 0, obTrades: 0, obNetR: 0, seqTrades: 0, seqNetR: 0 });
    const sym = new Map<string, EntryTrialRow>();
    const ses = new Map<string, EntryTrialRow>();
    const status = new Map<string, number>();
    const total = blank("ALL");
    for (const r of data ?? []) {
      if (r.seq_shadow_status) status.set(r.seq_shadow_status, (status.get(r.seq_shadow_status) ?? 0) + 1);
      const decided = ["target", "stop", "expired"].includes(r.status);
      if (!decided) continue;
      for (const row of [
        sym.get(r.symbol) ?? sym.set(r.symbol, blank(r.symbol)).get(r.symbol)!,
        ses.get(r.seq_session_phase ?? "unknown") ?? ses.set(r.seq_session_phase ?? "unknown", blank(r.seq_session_phase ?? "unknown")).get(r.seq_session_phase ?? "unknown")!,
        total,
      ]) {
        row.trades += 1;
        row.liveNetR += r.net_r == null ? 0 : Number(r.net_r);
        if (r.ob_shadow_r != null) { row.obTrades += 1; row.obNetR += Number(r.ob_shadow_r); }
        if (r.seq_shadow_r != null) { row.seqTrades += 1; row.seqNetR += Number(r.seq_shadow_r); }
      }
    }
    const fin = (r: EntryTrialRow): EntryTrialRow => ({ ...r, liveNetR: round(r.liveNetR), obNetR: round(r.obNetR), seqNetR: round(r.seqNetR) });
    return {
      bySymbol: [...sym.values()].map(fin).sort((a, b) => b.trades - a.trades),
      bySessionPhase: [...ses.values()].map(fin).sort((a, b) => b.trades - a.trades),
      seqStatus: [...status.entries()].map(([s, count]) => ({ status: s, count })).sort((a, b) => b.count - a.count),
      total: total.trades ? fin(total) : null,
    };
  });

/**
 * EUR/USD minimum-stop-width trial. Recomputed on demand from stored levels and
 * candles, so every new signal joins automatically; nothing live changes.
 */
export const getMinStopTrialReport = createServerFn({ method: "GET" })
  .middleware([requireCapability("signal_engine")])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("signal_scores")
      .select("symbol,bias,entry,stop,tp1,created_at")
      .eq("user_id", context.userId)
      .eq("symbol", "EUR/USD")
      .in("status", ["target", "stop"])
      .limit(1000);
    if (error) throw new Error(error.message);
    const { getHistory } = await import("@/lib/backtest/history.server");
    const { replayForward } = await import("@/lib/signal-replay");
    const { replayMinStopWidth } = await import("@/lib/exit-trials");
    const { costInR } = await import("@/lib/trading-costs");
    const bars = (await getHistory("EUR/USD", "60", "1y")).bars as never[];
    let trades = 0, actual = 0, trial = 0;
    for (const r of data ?? []) {
      const s = { bias: r.bias, entry: +r.entry, stop: +r.stop, tp1: +r.tp1, created_at: r.created_at };
      const risk = Math.abs(s.entry - s.stop);
      const base = replayForward(s, bars, { requireFill: true });
      const t = replayMinStopWidth(s, bars, "EUR/USD");
      if (base?.realizedR == null || t?.r == null) continue;
      const cost = costInR("EUR/USD", s.entry, risk);
      const newRisk = Math.max(risk, (cost * risk) / 0.1);
      trades++;
      actual += base.realizedR - cost;
      trial += t.r - costInR("EUR/USD", s.entry, newRisk);
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return { trades, actualNetR: round(actual), trialNetR: round(trial), deltaR: round(trial - actual) };
  });
