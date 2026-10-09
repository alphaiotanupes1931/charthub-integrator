// Writes a journal entry for every order TradeMind places at a broker, so the
// trader never has to log it by hand. The 15-minute journal checker then marks
// it as take profit / stop loss from real price history.
import { journalTimeframe } from "@/lib/journal-auto.shared";

export async function journalPlacedTrade(input: {
  userId: string;
  proposalId: string;
  symbol: string;
  side: "long" | "short";
  timeframe?: string | null;
  entry: number;
  stopLoss: number;
  takeProfit?: number | null;
  units: number;
  grade?: string | null;
  detail?: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = Date.now();
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const id = `auto-${input.proposalId}`;
    const { withLockedPlan } = await import("@/lib/journal-lock.shared");
    const trade = withLockedPlan({
      id,
      date,
      timeframe: journalTimeframe(input.timeframe),
      symbol: input.symbol,
      side: input.side === "short" ? "Short" : "Long",
      entry: input.entry,
      exit: input.entry,
      stop: input.stopLoss,
      takeProfit: input.takeProfit ?? undefined,
      size: input.units,
      notes: `Placed by TradeMind${input.grade ? ` from a ${input.grade} setup` : ""}. ${input.detail ?? ""}`.trim(),
      setup: input.grade ? `Scan ${input.grade}` : undefined,
      executed: true,
      executedAt: now,
      followedPlan: true,
      result: "open",
      createdAt: now,
    }, now);
    await supabaseAdmin
      .from("journal_trades")
      .upsert({ id, user_id: input.userId, data: trade as never, trade_date: date }, { onConflict: "user_id,id" });
  } catch (e) {
    console.error("[journal-auto] failed", (e as Error).message);
  }
}
