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
  // A failed read must NOT look like "the cloud matches local": the caller
  // would then mirror this device's list up and delete every cloud-only trade.
  if (error || !data) throw new Error(error?.message ?? "Could not read the cloud journal");


  const merged = new Map<string, SyncTrade>();
  for (const row of data) {
    const t = row.data as SyncTrade | null;
    if (t && typeof t.id === "string") merged.set(t.id, t);
  }
  for (const t of local) {
    if (!t || typeof t.id !== "string") continue;
    const remote = merged.get(t.id);
    // Local edits are usually the fresher copy; keep whichever has the later stamp.
    if (!remote || (t.createdAt ?? 0) >= (remote.createdAt ?? 0)) {
      // Exception: the 15-minute background checker writes the outcome on the
      // server. If the cloud copy has a newer result check and the trader
      // hasn't set the result by hand, carry those fields down.
      const localChecked = Number(t["resultCheckedAt"] ?? 0) || 0;
      const remoteChecked = Number(remote?.["resultCheckedAt"] ?? 0) || 0;
      if (remote && t["resultSource"] !== "manual" && remoteChecked > localChecked) {
        merged.set(t.id, {
          ...t,
          result: remote["result"],
          resultSource: remote["resultSource"],
          resultR: remote["resultR"],
          resultNote: remote["resultNote"],
          resultCheckedAt: remote["resultCheckedAt"],
        });
      } else {
        merged.set(t.id, t);
      }
    }
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
      data: JSON.parse(JSON.stringify(t)),
      trade_date: typeof t.date === "string" ? t.date : null,
    }));

  // Never treat an empty local list as "delete my whole account journal": a
  // fresh device starts empty, and wiping the cloud copy here is exactly how
  // trades disappeared when signing in on a phone.
  if (!rows.length) return;

  await supabase.from("journal_trades").upsert(rows, { onConflict: "user_id,id" });

  // Tie each journaled trade back to the scan that produced it, so the
  // scoreboard can report how the trades actually taken performed by grade.
  void linkTakenSignals(trades);

  const keep = rows.map((r) => r.id);
  await supabase
    .from("journal_trades")
    .delete()
    .eq("user_id", userId)
    .not("id", "in", `(${keep.map((id) => `"${id}"`).join(",")})`);
}


/**
 * Best-effort: match journaled trades to filed scans and mark those scans as
 * taken. Failures are silent - this only enriches reporting.
 */
async function linkTakenSignals(trades: SyncTrade[]): Promise<void> {
  try {
    const payload = trades
      .filter((t) => typeof t.id === "string" && typeof t["symbol"] === "string" && typeof t["side"] === "string")
      .slice(-200)
      .map((t) => ({
        id: t.id,
        symbol: String(t["symbol"]),
        side: String(t["side"]),
        entry: Number(t["entry"]) || null,
        takenAt:
          typeof t.date === "string" && t.date
            ? new Date(`${t.date}T12:00:00Z`).toISOString()
            : t.createdAt
              ? new Date(t.createdAt).toISOString()
              : null,
      }));
    if (!payload.length) return;
    const { linkJournalTradesToSignals } = await import("@/lib/journal-signal-link.functions");
    await linkJournalTradesToSignals({ data: { trades: payload } });
  } catch {
    /* reporting only */
  }
}
