// Day-0 activation: the scan a new trader sees right after onboarding, and the
// one-click "track it" that drops it into their journal with a locked plan.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FirstScanSetup = {
  symbol: string;
  grade: string;
  direction: "Long" | "Short";
  entry: number;
  stop: number;
  target: number;
  confidence: number | null;
  createdAt: string;
};

/** Best fresh A+/A/B setup from the live scanner, falling back to the latest graded one. */
export const getFirstScanSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ setup: FirstScanSetup | null }> => {
    const since = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data } = await context.supabase
      .from("signal_feed")
      .select("symbol, grade, bias, entry, stop, tp1, confidence, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    const rank = (g: string) => ["A+", "A", "B", "C", "D"].indexOf(g);
    const rows = (data ?? []).filter((r) => r.entry != null && r.stop != null && r.tp1 != null && rank(r.grade) >= 0);
    rows.sort((a, b) => rank(a.grade) - rank(b.grade) || (b.confidence ?? 0) - (a.confidence ?? 0));
    const r = rows[0];
    if (!r) return { setup: null };
    return {
      setup: {
        symbol: r.symbol,
        grade: r.grade,
        direction: /(short|sell|bear)/i.test(r.bias) ? "Short" : "Long",
        entry: Number(r.entry),
        stop: Number(r.stop),
        target: Number(r.tp1),
        confidence: r.confidence,
        createdAt: r.created_at,
      },
    };
  });

const TrackInput = z.object({
  symbol: z.string().min(1).max(20),
  grade: z.string().max(4),
  direction: z.enum(["Long", "Short"]),
  entry: z.number().finite(),
  stop: z.number().finite(),
  target: z.number().finite(),
});

/** Log the first scan to the journal as a watched (not executed) setup, plan locked. */
export const trackFirstScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => TrackInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { withLockedPlan } = await import("@/lib/journal-lock.shared");
    const now = Date.now();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const id = `first-scan-${now}`;
    const trade = withLockedPlan({
      id, date, timeframe: "1H", symbol: data.symbol, side: data.direction,
      entry: data.entry, exit: data.entry, stop: data.stop, takeProfit: data.target, size: 0,
      notes: `Your first TradeMind scan (${data.grade}). Tracked so you can see how it plays out.`,
      setup: `Scan ${data.grade}`, executed: false, followedPlan: true, result: "open", createdAt: now,
    }, now);
    const { error } = await context.supabase
      .from("journal_trades")
      .upsert({ id, user_id: context.userId, data: trade as never, trade_date: date }, { onConflict: "user_id,id" });
    if (error) throw new Error("Could not save to your journal");
    await context.supabase.from("profiles").update({ first_scan_done_at: new Date(now).toISOString() } as never).eq("id", context.userId);
    return { ok: true };
  });

export const skipFirstScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("profiles").update({ first_scan_done_at: new Date().toISOString() } as never).eq("id", context.userId);
    return { ok: true };
  });
