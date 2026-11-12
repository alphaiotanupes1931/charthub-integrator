import { matchBrokerCloses, type BrokerClose, type JournalRowLite } from "@/lib/journal-broker-sync.shared";

/** Write broker-confirmed exits and profit onto this user's journal rows. */
export async function syncBrokerClosesToJournal(userId: string): Promise<number> {
  const { buildBrokerSnapshots } = await import("@/lib/broker-readonly.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const snap = await buildBrokerSnapshots(userId);
  if (!snap.connected) return 0;
  const closes = snap.snapshots.flatMap((s) => s.recentCloses as unknown as BrokerClose[]);
  if (!closes.length) return 0;
  const { data } = await supabaseAdmin.from("journal_trades").select("id, data").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(300);
  const rows = ((data ?? []) as unknown as JournalRowLite[]).filter((r) => r.data);
  const updates = matchBrokerCloses(rows, closes);
  for (const u of updates) {
    await supabaseAdmin.from("journal_trades")
      .update({ data: u.data as never, trade_date: u.tradeDate, updated_at: new Date().toISOString() })
      .eq("id", u.id).eq("user_id", userId);
  }
  return updates.length;
}
