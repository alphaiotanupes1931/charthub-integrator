// Durable, server-side record of every scan the trader runs, with its price
// feed and (later) what price actually did. Feeds the daily trading review.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeScanLevels } from "@/lib/scan-log.shared";

const n = z.number().finite().nullable().optional();

const LogInput = z.object({
  source: z.string().max(20),
  symbol: z.string().min(1).max(24),
  timeframe: z.string().min(1).max(4),
  dataFeed: z.string().max(40).nullable().optional(),
  refPrice: n,
  bias: z.string().max(12),
  grade: z.string().min(1).max(10),
  confidence: n,
  strategyId: z.string().max(64).nullable().optional(),
  entry: n,
  stop: n,
  tp1: n,
  tp2: n,
  rr: z.string().max(20).nullable().optional(),
  reason: z.string().max(4000).nullable().optional(),
  counterTrend: z.boolean().nullable().optional(),
  htfBias: z.string().max(12).nullable().optional(),
  methodologyVersion: z.string().max(40).nullable().optional(),
  entryModel: z.string().max(40).nullable().optional(),
  gradeCaps: z.array(z.object({ label: z.string().max(80), cap: z.string().max(10) })).max(20).nullable().optional(),
});

export const logScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => LogInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string | null }> => {
    const lv = normalizeScanLevels(data);
    const { data: row } = await context.supabase
      .from("scan_log")
      .insert({
        user_id: context.userId,
        source: data.source,
        symbol: data.symbol,
        timeframe: data.timeframe,
        data_feed: data.dataFeed ?? null,
        ref_price: data.refPrice ?? null,
        bias: lv.bias,
        grade: data.grade,
        confidence: data.confidence ?? null,
        strategy_id: data.strategyId ?? null,
        entry: lv.entry,
        stop: lv.stop,
        tp1: lv.tp1,
        tp2: lv.tp2,
        rr: lv.directional ? (data.rr ?? null) : null,
        reason: data.reason ?? null,
        counter_trend: data.counterTrend ?? null,
        htf_bias: data.htfBias ?? null,
        methodology_version: data.methodologyVersion ?? null,
        entry_model: data.entryModel ?? null,
        grade_caps: data.gradeCaps ?? null,
        status: lv.status,
      })
      .select("id")
      .single();
    return { id: (row as { id: string } | null)?.id ?? null };
  });

export const linkScanScore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        scanId: z.string().uuid(),
        signalScoreId: z.string().uuid().nullable().optional(),
        refused: z.string().max(300).nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("scan_log")
      .update({ signal_score_id: data.signalScoreId ?? null, refused_reason: data.refused ?? null })
      .eq("id", data.scanId)
      .eq("user_id", context.userId);
    return { ok: true };
  });

export const markScanTaken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ symbol: z.string().min(1).max(24) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("scan_log")
      .select("id")
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol)
      .order("created_at", { ascending: false })
      .limit(1);
    const id = (rows?.[0] as { id: string } | undefined)?.id;
    if (id) await context.supabase.from("scan_log").update({ taken: true, taken_at: new Date().toISOString() }).eq("id", id);
    return { ok: !!id };
  });

export type ScanLogRow = {
  id: string;
  created_at: string;
  source: string;
  symbol: string;
  timeframe: string;
  data_feed: string | null;
  ref_price: number | null;
  bias: string;
  grade: string;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  status: string;
  realized_r: number | null;
  mae_r: number | null;
  mfe_r: number | null;
  refused_reason: string | null;
  taken: boolean;
};

export const listScanLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(raw))
  .handler(async ({ data, context }): Promise<ScanLogRow[]> => {
    const start = new Date(`${data.day}T00:00:00Z`);
    const end = new Date(start.getTime() + 86_400_000);
    const { data: rows } = await context.supabase
      .from("scan_log")
      .select("id, created_at, source, symbol, timeframe, data_feed, ref_price, bias, grade, entry, stop, tp1, status, realized_r, mae_r, mfe_r, refused_reason, taken")
      .eq("user_id", context.userId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false })
      .limit(500);
    return ((rows ?? []) as unknown as ScanLogRow[]).map((r) => ({
      ...r,
      ref_price: r.ref_price == null ? null : Number(r.ref_price),
      entry: r.entry == null ? null : Number(r.entry),
      stop: r.stop == null ? null : Number(r.stop),
      tp1: r.tp1 == null ? null : Number(r.tp1),
      realized_r: r.realized_r == null ? null : Number(r.realized_r),
      mae_r: r.mae_r == null ? null : Number(r.mae_r),
      mfe_r: r.mfe_r == null ? null : Number(r.mfe_r),
    }));
  });
