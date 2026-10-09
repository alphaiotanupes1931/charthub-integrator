// Server-only loader for the coach's trader memory. Reads with the caller's
// own (RLS-scoped) client.
import { buildTraderMemory, traderMemoryPromptBlock, type MemoryTrade } from "@/lib/trader-memory.shared";
import { planEdited } from "@/lib/journal-lock.shared";

type Client = { from: (t: string) => any };

export async function traderMemoryBlock(sb: Client, userId: string): Promise<string> {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const [scans, journal, msgs] = await Promise.all([
    sb.from("signal_scores").select("symbol,grade,taken,status,realized_r").eq("user_id", userId).gte("created_at", since).limit(1000),
    sb.from("journal_trades").select("data").eq("user_id", userId).gte("updated_at", since).limit(500),
    sb.from("chat_messages").select("parts").eq("user_id", userId).eq("role", "user").order("created_at", { ascending: false }).limit(40),
  ]);
  const trades: MemoryTrade[] = ((journal.data ?? []) as Array<{ data: Record<string, unknown> | null }>)
    .map((r) => r.data)
    .filter((d): d is Record<string, unknown> => !!d && typeof d["symbol"] === "string")
    .map((d) => ({ symbol: d["symbol"] as string, result: (d["result"] as string) ?? null, stopMoved: planEdited(d as never) }));
  const texts = ((msgs.data ?? []) as Array<{ parts: unknown }>).map((m) =>
    Array.isArray(m.parts)
      ? (m.parts as Array<{ type?: string; text?: string }>).filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join(" ")
      : "",
  );
  const memory = buildTraderMemory(
    ((scans.data ?? []) as Array<Record<string, unknown>>).map((s) => ({
      symbol: String(s["symbol"]),
      grade: (s["grade"] as string) ?? null,
      taken: !!s["taken"],
      status: (s["status"] as string) ?? null,
      realizedR: s["realized_r"] == null ? null : Number(s["realized_r"]),
    })),
    trades,
    texts,
  );
  return traderMemoryPromptBlock(memory);
}
