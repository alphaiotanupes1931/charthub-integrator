// Cloud sync for the trade journal. Trades used to live only in localStorage,
// so logging out or switching devices looked like the log had vanished.
// Every trade is now mirrored into `journal_trades` under the signed-in user.
import { supabase } from "@/integrations/supabase/client";

export type SyncTrade = { id: string; date?: string; createdAt?: number } & Record<string, unknown>;

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Pull remote trades and merge them with local ones (newest write wins per id). */
export async function pullAndMerge(local: SyncTrade[]): Promise<SyncTrade[]> {
  const userId = await currentUserId();
  if (!userId) return local;
  const { data, error } = await supabase
    .from("journal_trades")
    .select("id,data,updated_at")
    .eq("user_id", userId);
  if (error || !data) return local;

  const merged = new Map<string, SyncTrade>();
  for (const row of data) {
    const t = row.data as SyncTrade | null;
    if (t && typeof t.id === "string") merged.set(t.id, t);
  }
  for (const t of local) {
    if (!t || typeof t.id !== "string") continue;
    const remote = merged.get(t.id);
    // Local edits are usually the fresher copy; keep whichever has the later stamp.
    if (!remote || (t.createdAt ?? 0) >= (remote.createdAt ?? 0)) merged.set(t.id, t);
  }
  return [...merged.values()];
}

/** Mirror the full local list up: upsert everything, drop rows deleted locally. */
export async function pushAll(trades: SyncTrade[]): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const rows = trades
    .filter((t) => t && typeof t.id === "string")
    .map((t) => ({
      id: t.id,
      user_id: userId,
      data: t as unknown as Record<string, unknown>,
      trade_date: typeof t.date === "string" ? t.date : null,
    }));

  if (rows.length) {
    await supabase.from("journal_trades").upsert(rows, { onConflict: "user_id,id" });
  }

  const keep = rows.map((r) => r.id);
  let del = supabase.from("journal_trades").delete().eq("user_id", userId);
  if (keep.length) del = del.not("id", "in", `(${keep.map((id) => `"${id}"`).join(",")})`);
  await del;
}
