import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createAiGatewayProvider } from "@/lib/ai-gateway.server";
import {
  corsHeadersFor,
  enforceMaxBody,
  enforceOrigin,
  getOrCreateRequestId,
  preflight,
  rateLimit,
} from "@/lib/api-security";
import type { Database, Json } from "@/integrations/supabase/types";

const DAILY_AI_CAP = 100; // requests per user per UTC day

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

type ChartSnap = {
  source?: string;
  sourceLabel?: string;
  ticker?: string;
  interval?: string;
  lastPrice?: number;
  high20?: number; low20?: number;
  high50?: number; low50?: number;
  vwap?: number; poc?: number;
  sr?: number[];
  fib?: { ratio: number; price: number }[];
  liq?: { price: number; side: string }[];
  of?: { price: number; side: string; strength: number }[];
  delta?: number;
  sessionsActive?: string[];
  fetchedAt?: string;
};
type ChartCtx = { ticker?: string; intervalLabel?: string; enabledLevels?: string; snapshot?: ChartSnap };

type StrategyCtx = {
  name: string;
  level?: string;
  style?: string;
  markets?: string[];
  description?: string;
  winRate?: number;
  rr?: number;
};

type LensCtx = { id?: string; name?: string; promptEmphasis?: string };

type ChatRequestBody = {
  messages?: UIMessage[];
  threadId?: string;
  coach?: string;
  journal?: Trade[];
  chart?: ChartCtx;
  strategy?: StrategyCtx | null;
  lens?: LensCtx | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pnl(t: Trade) {
  const dir = t.side === "Long" ? 1 : -1;
  return (t.exit - t.entry) * dir * t.size;
}

function sessionFor(hourUtc: number): string {
  // FX trading sessions in UTC (approx, ignore DST)
  if (hourUtc >= 22 || hourUtc < 7) return "Sydney";
  if (hourUtc >= 0  && hourUtc < 8) return "Tokyo";
  if (hourUtc >= 8  && hourUtc < 13) return "London";
  if (hourUtc >= 13 && hourUtc < 17) return "London/NY overlap";
  if (hourUtc >= 17 && hourUtc < 22) return "New York";
  return "Off-hours";
}

function buildJournalContext(trades: Trade[]): string {
  if (!trades || trades.length === 0) return "The trader has not logged any trades yet.";
  const recent = trades.slice(-25);
  const wins = trades.filter((t) => pnl(t) > 0).length;
  const losses = trades.filter((t) => pnl(t) < 0).length;
  const total = wins + losses;
  const wr = total ? Math.round((wins / total) * 100) : 0;
  const totalPnl = trades.reduce((s, t) => s + pnl(t), 0);
  const avgWin = wins ? trades.filter((t) => pnl(t) > 0).reduce((s, t) => s + pnl(t), 0) / wins : 0;
  const avgLoss = losses ? trades.filter((t) => pnl(t) < 0).reduce((s, t) => s + pnl(t), 0) / losses : 0;
  const expectancy = total ? totalPnl / total : 0;

  const bucket = (key: string, t: Trade, acc: Record<string, { n: number; pnl: number; wins: number }>) => {
    acc[key] ??= { n: 0, pnl: 0, wins: 0 };
    acc[key].n++;
    acc[key].pnl += pnl(t);
    if (pnl(t) > 0) acc[key].wins++;
  };
  const fmt = (rec: Record<string, { n: number; pnl: number; wins: number }>) =>
    Object.entries(rec)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => `  - ${k}: ${v.n} trades, ${v.wins}W/${v.n - v.wins}L (${Math.round((v.wins / v.n) * 100)}%), P&L ${v.pnl.toFixed(2)}`)
      .join("\n");

  const bySymbol: Record<string, { n: number; pnl: number; wins: number }> = {};
  const bySide:   Record<string, { n: number; pnl: number; wins: number }> = {};
  const bySession:Record<string, { n: number; pnl: number; wins: number }> = {};
  const byDow:    Record<string, { n: number; pnl: number; wins: number }> = {};
  const byTf:     Record<string, { n: number; pnl: number; wins: number }> = {};
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (const t of trades) {
    bucket(t.symbol || "?", t, bySymbol);
    bucket(t.side, t, bySide);
    bucket(t.timeframe || "?", t, byTf);
    const d = new Date(t.date);
    if (!isNaN(d.getTime())) {
      bucket(sessionFor(d.getUTCHours()), t, bySession);
      bucket(DOW[d.getUTCDay()], t, byDow);
    }
  }

  const tradeLines = recent
    .map((t) => {
      const d = new Date(t.date);
      const sess = !isNaN(d.getTime()) ? sessionFor(d.getUTCHours()) : "?";
      return `  ${t.date} ${t.timeframe} ${t.symbol} ${t.side} [${sess}] entry=${t.entry} exit=${t.exit} stop=${t.stop} size=${t.size} pnl=${pnl(t).toFixed(2)}${t.notes ? ` // ${t.notes.slice(0, 120)}` : ""}`;
    })
    .join("\n");

  return [
    `STATS: ${trades.length} trades, ${wr}% win rate (${wins}W/${losses}L), net P&L ${totalPnl.toFixed(2)}, avg win ${avgWin.toFixed(2)}, avg loss ${avgLoss.toFixed(2)}, expectancy/trade ${expectancy.toFixed(2)}.`,
    `BY SYMBOL:\n${fmt(bySymbol)}`,
    `BY SIDE:\n${fmt(bySide)}`,
    `BY SESSION (UTC: Sydney/Tokyo/London/NY):\n${fmt(bySession)}`,
    `BY DAY OF WEEK:\n${fmt(byDow)}`,
    `BY TIMEFRAME:\n${fmt(byTf)}`,
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

function chartContextBlock(chart?: ChartCtx): string {
  if (!chart?.ticker) return "The trader has not selected a chart yet.";
  const lines: string[] = [
    `Symbol: ${chart.ticker}`,
    `Timeframe: ${chart.intervalLabel ?? "?"}`,
    `Levels currently on chart: ${chart.enabledLevels || "none"}`,
  ];
  const s = chart.snapshot;
  if (s) {
    const fmt = (n?: number, d = 2) => (typeof n === "number" && isFinite(n) ? n.toFixed(d) : "?");
    lines.push(
      "",
      `LIVE CHART DATA (snapshot from the user's screen, source: ${s.sourceLabel ?? s.source ?? "?"}, fetched ${s.fetchedAt ?? "?"}):`,
      `  Last price: ${fmt(s.lastPrice, 4)}`,
      `  20-bar range: ${fmt(s.low20, 4)} → ${fmt(s.high20, 4)}`,
      `  50-bar range: ${fmt(s.low50, 4)} → ${fmt(s.high50, 4)}`,
      `  VWAP: ${fmt(s.vwap, 4)}   POC: ${fmt(s.poc, 4)}   Cumulative delta: ${fmt(s.delta, 2)}`,
      s.sr?.length ? `  Swing S/R (recent): ${s.sr.map((p) => fmt(p, 4)).join(", ")}` : "",
      s.fib?.length ? `  Fib levels: ${s.fib.map((f) => `${f.ratio}=${fmt(f.price, 4)}`).join(", ")}` : "",
      s.liq?.length ? `  Liquidity pools: ${s.liq.map((l) => `${l.side}@${fmt(l.price, 4)}`).join(", ")}` : "",
      s.of?.length ? `  Order-flow initiative bars: ${s.of.map((o) => `${o.side}@${fmt(o.price, 4)} (${(o.strength * 100).toFixed(0)}%)`).join(", ")}` : "",
      s.sessionsActive?.length ? `  Active sessions right now: ${s.sessionsActive.join(", ")}` : `  Active sessions right now: none (off-hours)`,
    );
  } else {
    lines.push("", "Live chart data not yet loaded — answer generally and ask the trader to wait a moment for the feed.");
  }
  return lines.filter(Boolean).join("\n");
}

function strategyContextBlock(strat?: StrategyCtx | null): string {
  if (!strat?.name) {
    return "The trader has NOT selected an active strategy. Encourage them to pick one from the Strategy Library so you can grade setups against concrete rules.";
  }
  const lines = [
    `ACTIVE STRATEGY: ${strat.name}`,
    strat.style ? `Style: ${strat.style}` : "",
    strat.level ? `Level: ${strat.level}` : "",
    strat.markets?.length ? `Markets: ${strat.markets.join(", ")}` : "",
    typeof strat.winRate === "number" ? `Baseline win rate: ${strat.winRate}%` : "",
    typeof strat.rr === "number" ? `Baseline R:R: ${strat.rr}` : "",
    strat.description ? `Playbook: ${strat.description}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function lensContextBlock(lens?: LensCtx | null): string {
  if (!lens?.name || !lens?.promptEmphasis) {
    return "Default lens: Wyckoff Core. Sweep -> BOS -> Retest is mandatory; no overlay bias.";
  }
  return `ACTIVE LENS: ${lens.name}\nEmphasis: ${lens.promptEmphasis}`;
}

function systemPrompt(coach: string | undefined, journalContext: string, chartCtx: string, strategyCtx: string, lensCtx: string) {
  return `${coachPersona(coach)}

You are TradeMind, the trader's personal AI coach. You have full access to the trader's journal (below), the live chart context they're looking at right now, the trader's ACTIVE STRATEGY (below), the trader's ACTIVE SCAN LENS (below), and the entire conversation history of this thread — use all of them to give specific, personalized feedback. Reference real trades by date and symbol. PROACTIVELY surface patterns from the journal: which symbol/side/session/day-of-week/timeframe has the highest and lowest win rate and P&L, which combinations are tilting the curve, and any repeated mistake visible in the notes. When the user asks for a recommendation, weight it by what's actually working in their data (e.g. "you're +68% on London-session XAU longs, that's your A+ setup"). When you spot a clearly losing pattern, name it bluntly and tell them to stop or size down.

EVERY setup, entry, or recommendation MUST be graded against the active strategy AND read through the active scan lens: confirm whether the current chart matches the strategy's rules and the lens's emphasis, and if it doesn't, refuse or flag it as off-playbook / off-lens. Reference the lens name AND the strategy name in your reply so the trader knows you're using them. If no strategy is set, say so and ask them to pick one before you grade setups. The scan lens is always set — apply it.

When they ask you to analyze a setup or "give me entry, stop, target", assume they mean the symbol and timeframe in the LIVE CHART block below unless they name a different one. Always produce a concrete plan: bias (long/short/neutral), entry trigger with a price or zone, invalidation/stop, take profit 1 and 2, R:R, and a 1–2 sentence rationale tied to the levels they have enabled AND the active strategy's rules AND the active lens's emphasis. If exact prices aren't possible without live OHLC, give clearly-labeled illustrative levels and tell them to confirm against price.

Rules:
- Be conversational, like a real coach. Short paragraphs. Direct.
- If they ask what a term means (FVG, OB, liquidity sweep, R-multiple, etc.), explain plainly.
- Never invent trades that aren't in their journal. If you don't have the data, say so.
- Do not use emojis or decorative symbols.

=== ACTIVE SCAN LENS ===
${lensCtx}
=== END LENS ===

=== ACTIVE STRATEGY ===
${strategyCtx}
=== END STRATEGY ===

=== LIVE CHART ===
${chartCtx}
=== END CHART ===

=== TRADER'S JOURNAL ===
${journalContext}
=== END JOURNAL ===`;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request) ?? new Response(null, { status: 204 }),
      POST: async ({ request }) => {
        const reqId = getOrCreateRequestId(request);
        const originBlock = enforceOrigin(request);
        if (originBlock) return originBlock;
        const tooBig = enforceMaxBody(request, 512 * 1024); // 512 KB cap
        if (tooBig) return tooBig;
        const limited = rateLimit(request, { key: "chat", limit: 20, windowMs: 60_000 });
        if (limited) return limited;

        const cors = { ...corsHeadersFor(request), "X-Request-Id": reqId };
        console.log(`[chat] req=${reqId} start`);

        // --- Auth: verify the bearer token ---
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401, headers: cors });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token || token.split(".").length !== 3) {
          return new Response("Unauthorized", { status: 401, headers: cors });
        }

        const sb = createClient<Database>(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          },
        );

        const { data: claims, error: claimsErr } = await sb.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) {
          return new Response("Unauthorized", { status: 401, headers: cors });
        }
        const userId = claims.claims.sub;

        // --- Parse body ---
        let body: ChatRequestBody;
        try {
          body = (await request.json()) as ChatRequestBody;
        } catch {
          return new Response("Invalid JSON", { status: 400, headers: cors });
        }
        const { messages, threadId, coach, journal, chart, strategy, lens } = body;
        if (!Array.isArray(messages) || !threadId) {
          return new Response("messages, threadId required", { status: 400, headers: cors });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("AI not configured", { status: 500, headers: cors });

        // --- Verify thread ownership when this is a persisted chat thread. ---
        // The dashboard coach can start in ephemeral mode while the protected
        // thread loader is still warming up, so non-UUID thread IDs are allowed
        // for a live AI response but are not written to the database.
        const shouldPersist = UUID_RE.test(threadId);
        let thread: { id: string; title: string; user_id: string | null } | null = null;
        if (shouldPersist) {
          const { data: threadRow, error: threadErr } = await sb
            .from("chat_threads")
            .select("id,title,user_id")
            .eq("id", threadId)
            .maybeSingle();
          if (threadErr || !threadRow || threadRow.user_id !== userId) {
            return new Response("Forbidden", { status: 403, headers: cors });
          }
          thread = threadRow;
        }

        // --- Daily AI cap per user (UTC) ---
        const { data: usageCount, error: usageErr } = await sb.rpc("bump_ai_usage", { _cap: DAILY_AI_CAP });
        if (usageErr) {
          const msg = (usageErr.message || "").toLowerCase();
          if (msg.includes("daily_cap_reached")) {
            console.log(`[chat] req=${reqId} user=${userId} cap_reached`);
            return new Response(
              JSON.stringify({
                error: "daily_cap_reached",
                message: "You have ran out of AI credits for the day, feel free to keep trading. Your AI coach will be back tomorrow.",
                cap: DAILY_AI_CAP,
              }),
              { status: 429, headers: { ...cors, "Content-Type": "application/json" } },
            );
          }
          console.error(`[chat] req=${reqId} usage_error`, usageErr.message);
          // Fail open on internal errors so a usage bug doesn't lock everyone out.
        } else {
          console.log(`[chat] req=${reqId} user=${userId} usage=${usageCount}/${DAILY_AI_CAP}`);
        }

        const journalCtx = buildJournalContext(journal ?? []);
        const system = systemPrompt(coach, journalCtx, chartContextBlock(chart), strategyContextBlock(strategy), lensContextBlock(lens));

        const gateway = createAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system,
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          onFinish: async ({ messages: finalMessages }) => {
            if (!shouldPersist || !thread) return;
            try {
              const { data: existing } = await sb
                .from("chat_messages")
                .select("id")
                .eq("thread_id", threadId);
              const existingIds = new Set((existing ?? []).map((r) => r.id as string));
              const toInsert = finalMessages
                .filter((m) => !existingIds.has(m.id))
                .map((m) => ({
                  thread_id: threadId,
                  user_id: userId,
                  client_id: userId, // legacy NOT NULL column
                  role: m.role,
                  parts: m.parts as unknown as Json,
                }));
              if (toInsert.length > 0) {
                const { error } = await sb.from("chat_messages").insert(toInsert);
                if (error) console.error("[chat] persist error", error.message);
              }
              // Auto-title from first user message
              const firstUser = finalMessages.find((m) => m.role === "user");
              if (firstUser && thread.title === "New conversation") {
                const text = (firstUser.parts as Array<{ type: string; text?: string }>)
                  .filter((p) => p.type === "text")
                  .map((p) => p.text ?? "")
                  .join(" ")
                  .trim();
                if (text) {
                  await sb
                    .from("chat_threads")
                    .update({ title: text.slice(0, 60) })
                    .eq("id", threadId);
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
