// Links journaled trades back to the scan that produced them.
//
// Until now a signal was only marked "taken" when the trader used the To
// Journal button straight off a scan. Anyone logging the trade by hand left
// every filed signal marked as skipped, so "how did the trades I actually took
// perform, by grade" had no data behind it. This matches a journaled trade to
// the closest filed signal on the same instrument and side and stamps it taken.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  trades: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        symbol: z.string().min(1).max(24),
        side: z.string().min(1).max(12),
        entry: z.number().finite().nullable().optional(),
        takenAt: z.string().min(4).max(40).nullable().optional(),
      }),
    )
    .max(200),
});

/** Hours either side of the journaled trade in which a scan counts as its source. */
const WINDOW_HOURS = 48;

type SignalRow = {
  id: string;
  symbol: string;
  bias: string;
  grade: string;
  entry: number | string;
  created_at: string;
  taken: boolean;
};

const dirOf = (v: string) => (v.trim().toLowerCase().startsWith("s") ? "short" : "long");
/**
 * Journal entries and scans do not always spell an instrument the same way
 * ("XAU/USD" against "XAUUSD"), and a strict string compare is why no journaled
 * trade had ever linked to a filed scan.
 */
const symKey = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export const linkJournalTradesToSignals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }): Promise<{ linked: Record<string, string> }> => {
    const linked: Record<string, string> = {};
    if (!data.trades.length) return { linked };

    const oldest = data.trades
      .map((t) => (t.takenAt ? Date.parse(t.takenAt) : NaN))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)[0];
    const since = new Date(
      (Number.isFinite(oldest) ? (oldest as number) : Date.now() - 90 * 864e5) - WINDOW_HOURS * 36e5,
    ).toISOString();

    const { data: rows } = await context.supabase
      .from("signal_scores")
      .select("id, symbol, bias, grade, entry, created_at, taken")
      .eq("user_id", context.userId)
      // Symbols are matched in memory, not in the query: the journal and the scan
      // record spell the same instrument differently often enough that filtering
      // on the exact string here returned nothing at all.
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);

    const signals = (rows ?? []) as SignalRow[];
    if (!signals.length) return { linked };

    const claimed = new Set<string>();
    const toMark: string[] = [];

    for (const trade of data.trades) {
      const at = trade.takenAt ? Date.parse(trade.takenAt) : NaN;
      const dir = dirOf(trade.side);
      let best: SignalRow | null = null;
      let bestScore = Infinity;

      for (const s of signals) {
        if (claimed.has(s.id)) continue;
        if (symKey(s.symbol) !== symKey(trade.symbol)) continue;
        if (dirOf(s.bias) !== dir) continue;
        const gap = Number.isFinite(at) ? Math.abs(Date.parse(s.created_at) - (at as number)) : 0;
        if (Number.isFinite(at) && gap > WINDOW_HOURS * 36e5) continue;
        // Prefer the scan closest in time, then the closest entry price.
        const priceGap =
          trade.entry != null && Number(s.entry)
            ? Math.abs(Number(s.entry) - trade.entry) / Math.abs(Number(s.entry))
            : 0;
        const score = gap / 36e5 + priceGap * 100;
        if (score < bestScore) {
          bestScore = score;
          best = s;
        }
      }

      if (!best) continue;
      claimed.add(best.id);
      linked[trade.id] = best.grade;
      if (!best.taken) toMark.push(best.id);
    }

    if (toMark.length) {
      await context.supabase.from("signal_scores").update({ taken: true }).in("id", toMark);
    }
    return { linked };
  });
