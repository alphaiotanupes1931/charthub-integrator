import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import type { Database } from "@/integrations/supabase/types";

type Trade = {
  id: string;
  date: string;
  timeframe: string;
  symbol: string;
  side: "Long" | "Short";
  entry: number;
  exit: number;
  stop: number;
  size: number;
  notes: string;
};

type ChatRequestBody = {
  messages?: UIMessage[];
  threadId?: string;
  clientId?: string;
  coach?: string;
  journal?: Trade[];
};

function pnl(t: Trade) {
  const dir = t.side === "Long" ? 1 : -1;
  return (t.exit - t.entry) * dir * t.size;
}

function buildJournalContext(trades: Trade[]): string {
  if (!trades || trades.length === 0) return "The trader has not logged any trades yet.";
  const recent = trades.slice(-25);
  const wins = trades.filter((t) => pnl(t) > 0).length;
  const losses = trades.filter((t) => pnl(t) < 0).length;
  const total = wins + losses;
  const wr = total ? Math.round((wins / total) * 100) : 0;
  const totalPnl = trades.reduce((s, t) => s + pnl(t), 0);
  const bySymbol: Record<string, { n: number; pnl: number; wins: number }> = {};
  for (const t of trades) {
    const k = t.symbol || "?";
    bySymbol[k] ??= { n: 0, pnl: 0, wins: 0 };
    bySymbol[k].n++;
    bySymbol[k].pnl += pnl(t);
    if (pnl(t) > 0) bySymbol[k].wins++;
  }
  const symLines = Object.entries(bySymbol)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 6)
    .map(([s, v]) => `  - ${s}: ${v.n} trades, ${v.wins}W/${v.n - v.wins}L, P&L ${v.pnl.toFixed(2)}`)
    .join("\n");
  const tradeLines = recent
    .map(
      (t) =>
        `  ${t.date} ${t.timeframe} ${t.symbol} ${t.side} entry=${t.entry} exit=${t.exit} stop=${t.stop} size=${t.size} pnl=${pnl(t).toFixed(2)}${t.notes ? ` // ${t.notes.slice(0, 120)}` : ""}`,
    )
    .join("\n");
  return [
    `STATS: ${trades.length} total trades, ${wr}% win rate (${wins}W/${losses}L), net P&L ${totalPnl.toFixed(2)}.`,
    `BY SYMBOL:`,
    symLines,
    `RECENT TRADES (last ${recent.length}):`,
    tradeLines,
  ].join("\n");
}

function coachPersona(coach?: string) {
  switch (coach) {
    case "The Disciplinarian":
      return "You are The Disciplinarian — strict, direct, zero tolerance for rule-breaking. Hold the trader accountable. Call out revenge trades, oversized positions, and breaks of their stated plan. Be blunt but professional.";
    case "The Mentor":
      return "You are The Mentor — a patient, seasoned trader. Teach through analogies and lived experience. Build confidence, never condescend. Long-term growth mindset.";
    case "The Analyst":
    default:
      return "You are The Analyst — a data-driven trading coach. Speak in numbers, edge, R-multiples, win rate, expectancy. Precise, surgical, no fluff.";
  }
}

function systemPrompt(coach: string | undefined, journalContext: string) {
  return `${coachPersona(coach)}

You are TradeMind, the trader's personal AI coach. You have full access to the trader's journal (below) and the entire conversation history of this thread — use them to give specific, personalized feedback. Reference real trades by date and symbol. Identify patterns: best/worst setups, time-of-day edge, symbols where they bleed, repeated mistakes. When they ask "what's my weakness", answer from the data.

Rules:
- Be conversational, like a real coach. Short paragraphs. Direct.
- When they describe a setup, walk through it: bias, entry trigger, invalidation, target, R:R, position size.
- If they ask what a term means (FVG, OB, liquidity sweep, R-multiple, etc.), explain plainly.
- Never invent trades that aren't in their journal. If you don't have the data, say so.
- Do not use emojis or decorative symbols.

=== TRADER'S JOURNAL ===
${journalContext}
=== END JOURNAL ===`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: ChatRequestBody;
        try {
          body = (await request.json()) as ChatRequestBody;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const { messages, threadId, clientId, coach, journal } = body;
        if (!Array.isArray(messages) || !threadId || !clientId) {
          return new Response("messages, threadId, clientId required", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("AI not configured", { status: 500 });

        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
        );

        const journalCtx = buildJournalContext(journal ?? []);
        const system = systemPrompt(coach, journalCtx);

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system,
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: finalMessages }) => {
            try {
              // Persist only messages not already saved (by id)
              const { data: existing } = await sb
                .from("chat_messages")
                .select("id")
                .eq("thread_id", threadId);
              const existingIds = new Set((existing ?? []).map((r) => r.id as string));
              const toInsert = finalMessages
                .filter((m) => !existingIds.has(m.id))
                .map((m) => ({
                  id: m.id,
                  thread_id: threadId,
                  client_id: clientId,
                  role: m.role,
                  parts: m.parts as unknown as Record<string, unknown>,
                }));
              if (toInsert.length > 0) {
                const { error } = await sb.from("chat_messages").insert(toInsert);
                if (error) console.error("[chat] persist error", error.message);
              }
              // Auto-title from first user message
              const firstUser = finalMessages.find((m) => m.role === "user");
              if (firstUser) {
                const text = (firstUser.parts as Array<{ type: string; text?: string }>)
                  .filter((p) => p.type === "text")
                  .map((p) => p.text ?? "")
                  .join(" ")
                  .trim();
                if (text) {
                  const { data: thread } = await sb
                    .from("chat_threads")
                    .select("title")
                    .eq("id", threadId)
                    .maybeSingle();
                  if (thread && thread.title === "New conversation") {
                    await sb
                      .from("chat_threads")
                      .update({ title: text.slice(0, 60) })
                      .eq("id", threadId);
                  }
                }
              }
            } catch (e) {
              console.error("[chat] onFinish error", e);
            }
          },
        });
      },
    },
  },
});
