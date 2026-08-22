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

const RecordInput = z.object({
  symbol: z.string().min(1).max(24),
  timeframe: z.string().min(1).max(4),
  grade: z.string().min(1).max(8),
  bias: z.string().min(1).max(12),
  confidence: z.number().min(0).max(100).nullable().optional(),
  strategyId: z.string().max(64).nullable().optional(),
  entry: z.number().finite(),
  stop: z.number().finite(),
  tp1: z.number().finite(),
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
  };
}

/** File a scan result. Duplicate scans of the same symbol/level inside 10 minutes are ignored. */
export const recordSignalScore = createServerFn({ method: "POST" })
  .middleware([requireCapability("signal_engine")])
  .inputValidator((raw: unknown) => RecordInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean; id?: string }> => {
    const risk = Math.abs(data.entry - data.stop);
    if (!risk) return { ok: false };
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

    const plannedR = Math.round((Math.abs(data.tp1 - data.entry) / risk) * 100) / 100;
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
      })
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
      .select("id, symbol, timeframe, bias, entry, stop, tp1, created_at")
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
      });
      if (res.status === "open") continue;
      await context.supabase
        .from("signal_scores")
        .update({ status: res.status, realized_r: res.realizedR, resolved_at: new Date().toISOString() })
        .eq("id", sig.id);
      resolved += 1;
    }
    return { checked: open.length, resolved };
  });
