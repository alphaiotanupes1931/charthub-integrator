/**
 * Public, auditable track record.
 *
 * The scoreboard is the private view of one trader's scans. This is the version a
 * stranger can check: every resolved signal across the whole engine, with the
 * terms it was filed on, the outcome the bars produced, and the fingerprint that
 * proves the terms were not edited afterwards.
 *
 * Rules this endpoint holds to:
 *  - Net first. Costs are estimated from a static per-instrument spread table,
 *    never from historical spread, and the page says so.
 *  - No-direction scans are excluded from every aggregate, as everywhere else.
 *  - Nothing identifying is returned: no user id, no strategy id, no note text.
 *  - Only decided and expired rows are published. Open scans are counted, not shown,
 *    so the record cannot be read as a live signal feed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildScoreboard, type Scoreboard, type SignalScoreRow } from "@/lib/signal-scores.shared";

export type PublicRecordRow = {
  filedAt: string;
  symbol: string;
  timeframe: string;
  bias: string;
  grade: string;
  entry: number;
  stop: number;
  tp1: number;
  plannedR: number | null;
  status: string;
  realizedR: number | null;
  netR: number | null;
  costR: number | null;
  maeR: number | null;
  mfeR: number | null;
  /** First 12 characters of the filing fingerprint: enough to cite, not a secret. */
  seal: string | null;
};

export type PublicRecord = {
  scoreboard: Scoreboard;
  rows: PublicRecordRow[];
  integrity: {
    published: number;
    sealed: number;
    unsealed: number;
  };
  /** Honest limits, rendered on the page rather than buried. */
  caveats: string[];
  generatedAt: string;
};

const Input = z.object({ limit: z.number().int().min(50).max(1000).optional() }).optional();

export const getPublicRecord = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => Input.parse(raw) ?? {})
  .handler(async ({ data }): Promise<PublicRecord> => {
    const limit = data?.limit ?? 1000;
    // Aggregating across every trader's filed scans is a privileged read, so it runs
    // server-side with an explicit column projection: nothing identifying is selected.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: raw, error } = await supabaseAdmin
      .from("signal_scores")
      .select(
        "id,symbol,timeframe,grade,bias,confidence,entry,stop,tp1,planned_r,status,realized_r,net_r,cost_r,mae_r,mfe_r,resolved_at,created_at,counter_trend,htf_bias,filed_hash",
      )
      .in("status", ["target", "stop", "expired", "open", "void"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const all = (raw ?? []) as Array<Record<string, unknown>>;

    const scoreRows: SignalScoreRow[] = all.map((r) => ({
      id: String(r.id),
      symbol: String(r.symbol),
      timeframe: String(r.timeframe),
      grade: String(r.grade),
      bias: String(r.bias),
      confidence: num(r.confidence),
      strategyId: null,
      entry: Number(r.entry),
      stop: Number(r.stop),
      tp1: Number(r.tp1),
      plannedR: num(r.planned_r),
      status: String(r.status) as SignalScoreRow["status"],
      realizedR: num(r.realized_r),
      resolvedAt: (r.resolved_at as string | null) ?? null,
      taken: false,
      createdAt: String(r.created_at),
      counterTrend: Boolean(r.counter_trend),
      htfBias: (r.htf_bias as string | null) ?? null,
      netR: num(r.net_r),
      costR: num(r.cost_r),
      maeR: num(r.mae_r),
      mfeR: num(r.mfe_r),
    }));

    const publishable = all.filter((r) => ["target", "stop", "expired"].includes(String(r.status)));
    const rows: PublicRecordRow[] = publishable.map((r) => ({
      filedAt: String(r.created_at),
      symbol: String(r.symbol),
      timeframe: String(r.timeframe),
      bias: String(r.bias),
      grade: String(r.grade),
      entry: Number(r.entry),
      stop: Number(r.stop),
      tp1: Number(r.tp1),
      plannedR: num(r.planned_r),
      status: String(r.status),
      realizedR: num(r.realized_r),
      netR: num(r.net_r),
      costR: num(r.cost_r),
      maeR: num(r.mae_r),
      mfeR: num(r.mfe_r),
      seal: r.filed_hash ? String(r.filed_hash).slice(0, 12) : null,
    }));

    const sealed = publishable.filter((r) => Boolean(r.filed_hash)).length;

    return {
      scoreboard: buildScoreboard(scoreRows),
      rows,
      integrity: {
        published: publishable.length,
        sealed,
        unsealed: publishable.length - sealed,
      },
      caveats: [
        "Net R subtracts an estimated spread and slippage taken from a static per-instrument table. It is an estimate, not the spread that was quoted at the moment each signal was filed.",
        "Resolved means the stop or the first target actually printed on closed bars. Signals that timed out are reported on their own line and are never counted as a win or a loss.",
        "Scans with no directional read are kept in the record for the audit trail and excluded from every figure above.",
        "Whether a signal was actually traded was not linked to scans before this record existed, so taken-versus-skipped only accumulates from now on.",
        "Two data-quality items are still open: how long a signal is allowed to run before it expires, and how same-bar fills are treated. Both are resolved pessimistically today.",
      ],
      generatedAt: new Date().toISOString(),
    };
  });
