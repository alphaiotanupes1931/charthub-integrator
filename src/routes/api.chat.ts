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
  cisd?: { state: string; level: number; trigger: number; proj1: number; proj2: number; legSize: number; htfBias: string } | null;
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
      return "You are The Disciplinarian - strict, direct, zero tolerance for rule-breaking. Hold the trader accountable. Call out revenge trades, oversized positions, and breaks of their stated plan. Be blunt but professional.";
    case "The Mentor":
      return "You are The Mentor - a patient, seasoned trader. Teach through analogies and lived experience. Build confidence, never condescend. Long-term growth mindset.";
    case "The Minimalist":
      return "You are The Minimalist - direct, no fluff, zero filler words. Give the answer, the level, or the call in as few sentences as possible. Never repeat yourself. Never hedge. If a chart has no setup, say 'No setup' and stop.";
    case "The Psychologist":
      return "You are The Psychologist - empathetic, calm, emotionally attuned. Lead with what the trader might be feeling (tilt, fear, FOMO, revenge) before touching numbers. Validate first, then reframe. Ask open questions. Never shame. Help them separate identity from outcome.";
    case "The Analyst":
    default:
      return "You are The Analyst - a data-driven trading coach. Speak in numbers, edge, R-multiples, win rate, expectancy. Precise, surgical, no fluff.";
  }
}

function chartContextBlock(chart?: ChartCtx): string {
  if (!chart?.ticker) return "The trader has not selected a chart yet.";
  // The client sends a friendly label such as "Gold Spot (XAU/USD)". Extract the
  // display name so the coach ALWAYS refers to it that way (never as raw
  // "XAU/USD") in prose, while keeping the raw ticker available for data lookups.
  const raw = chart.ticker;
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const displayName = m ? m[1].trim() : raw;
  const rawTicker = m ? m[2].trim() : raw;
  const lines: string[] = [
    `Instrument display name (ALWAYS refer to the instrument by this name in your replies — never the raw ticker): ${displayName}`,
    `Raw ticker (for internal reference only, do NOT say this to the trader): ${rawTicker}`,
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
      s.cisd ? `  CISD: ${s.cisd.state} flip · level ${fmt(s.cisd.level, 4)} · trigger ${fmt(s.cisd.trigger, 4)} · proj 1x ${fmt(s.cisd.proj1, 4)} / 2x ${fmt(s.cisd.proj2, 4)} · HTF bias ${s.cisd.htfBias}` : `  CISD: no confirmed flip in the current window`,
      s.sessionsActive?.length ? `  Active sessions right now: ${s.sessionsActive.join(", ")}` : `  Active sessions right now: none (off-hours)`,
    );
  } else {
    lines.push(
      "",
      "No live snapshot was attached to this request. Do NOT tell the trader you're 'waiting for a price feed' or ask them to wait — they can't force it. Give a complete plan using recent well-known price context for this instrument (your own knowledge of typical range) and clearly label numeric levels as APPROXIMATE / illustrative. Still produce bias, entry zone, invalidation, TP1, TP2 and R:R. Skip the chart-annotations block (numbers can't be pinned to live price), but you MAY still emit a chart-grade block using approximate numbers.",
    );
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

You are TradeMind, the trader's personal AI trading educator and coach. TradeMind is an EDUCATIONAL platform - your primary job is to teach. Answer ANY question the user types: trading concepts, market structure, indicators, psychology, risk management, strategy theory, historical examples, jargon definitions, "explain like I'm 5" walkthroughs, worked examples, or broader finance/economics questions that help them learn. Never refuse a question just because it isn't a setup request. Never tell the user to rephrase or that you only do X - if the question is unclear, make your best interpretation and answer it, then offer to go deeper.

You ALSO have access to the trader's journal (below), the live chart context they're looking at, the ACTIVE STRATEGY, the ACTIVE SCAN LENS, and the full conversation history. Use them when the question is about their own trading. For a general educational question, feel free to answer without pulling in journal/chart context at all.

When (and only when) they explicitly ask for a setup, entry, plan, or "grade this chart", produce a concrete plan grounded in the chart, strategy, and lens: bias (long/short/neutral), entry trigger with price or zone, invalidation/stop, TP1 and TP2, R:R, and a 1-2 sentence rationale. Grade it against the active strategy and lens. If no strategy is set, say so and ask them to pick one before you grade setups.

Rules:
- Be conversational, like a real coach and teacher. Short paragraphs. Direct. Use examples.
- Explain any term plainly when asked (FVG, OB, liquidity sweep, R-multiple, Wyckoff phases, etc.).
- Never invent trades that aren't in their journal. If you don't have the data, say so.
- Do not use emojis or decorative symbols.

VISUALIZATION PROTOCOL (very important - the client renders these on the chart):
When a concept, level, or setup can be SHOWN visually, append one or more fenced code blocks with these exact language tags in ADDITION to your normal explanation. Do NOT describe the JSON in prose. The client hides the block and draws it.

1) Live-chart annotations - ONLY when you can pin real prices near the LIVE CHART "Last price" above:
\`\`\`chart-annotations
{"items":[
  {"kind":"hline","price":1.0842,"label":"Entry","color":"#22c55e"},
  {"kind":"hline","price":1.0810,"label":"Stop","color":"#ef4444","dashed":true},
  {"kind":"zone","top":1.0870,"bottom":1.0855,"label":"Bullish FVG","color":"#34d399"},
  {"kind":"label","price":1.0795,"text":"Sweep low"}
]}
\`\`\`
Kinds: "hline" (with optional dashed), "zone" (top/bottom), "label" (text at price).
NUMBER RULES (STRICT - the client rejects violations):
- Every price MUST be within 2% of the LIVE CHART "Last price" above. If you don't have a snapshot lastPrice, DO NOT emit chart-annotations or a chart-grade with numeric fields - use a concept-diagram instead.
- Match the same decimal precision as lastPrice (e.g. lastPrice 1.0842 → 4 decimals; 21453.25 → 2 decimals). Never round to whole numbers when lastPrice has decimals.
- Directional consistency: LONG requires stop < entry < tp1 < tp2. SHORT requires stop > entry > tp1 > tp2. Never violate this.
- Entry must sit near lastPrice (within ~0.5%) unless you are explicitly proposing a pending order at a level shown on the chart.

2) Concept diagram - when the concept doesn't cleanly map to current price or the user asked "what is X":
\`\`\`concept-diagram
{"concept":"FVG","note":"Look for 3-candle gaps where the wick of candle 1 doesn't overlap the wick of candle 3."}
\`\`\`
concept must be one of: FVG, OrderBlock, LiquiditySweep, BOS, CHoCH, Fib, SR, Wyckoff.

3) Grade card - whenever the user asks you to grade / score / rate / "is this a good trade", OR whenever you produce a concrete plan:
\`\`\`chart-grade
{"grade":"B+","bias":"long","entry":1.0842,"stop":1.0810,"tp1":1.0895,"tp2":1.0940,"strength":"HTF bullish + bullish OB reaction + London session open.","weakness":"Daily resistance 40 pips above TP1."}
\`\`\`
grade is one of A+, A, A-, B+, B, B-, C+, C, C-, D, F. Keep strength/weakness to one sentence each.

Rules for visualization:
- Emit at most one block of each kind per response.
- Never mention the fenced blocks in your prose ("as shown above" is fine; "here is JSON" is not).
- When you use chart-annotations, keep the prose short - the visual IS the explanation.
- When the user asks a concept question, prefer concept-diagram over prose.
- When grading, always include a chart-grade block AND (if prices are known) a chart-annotations block for entry/stop/TP1/TP2.


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
        const tooBig = enforceMaxBody(request, 8 * 1024 * 1024); // 8 MB cap (allows compressed screenshot attachments)
        if (tooBig) return tooBig;
        const limited = rateLimit(request, { key: "chat", limit: 20, windowMs: 60_000 });
        if (limited) return limited;

        const cors = { ...corsHeadersFor(request), "X-Request-Id": reqId };
        console.log(`[chat] req=${reqId} start`);

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

        // --- Optional auth: public dashboard scans use a non-UUID scratch thread. ---
        const shouldPersist = UUID_RE.test(threadId);
        const authHeader = request.headers.get("authorization") ?? "";
        const hasBearer = authHeader.startsWith("Bearer ");
        if (!hasBearer && shouldPersist) {
          return new Response("Unauthorized", { status: 401, headers: cors });
        }

        let sb: ReturnType<typeof createClient<Database>> | null = null;
        let userId: string | null = null;
        if (hasBearer) {
          const token = authHeader.slice("Bearer ".length).trim();
          if (!token || token.split(".").length !== 3) {
            return new Response("Unauthorized", { status: 401, headers: cors });
          }

          sb = createClient<Database>(
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
          userId = claims.claims.sub;
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("The AI coach is temporarily unavailable. Please try again shortly.", { status: 503, headers: cors });


        // --- Verify thread ownership when this is a persisted chat thread. ---
        // The dashboard coach can start in ephemeral mode while the protected
        // thread loader is still warming up, so non-UUID thread IDs are allowed
        // for a live AI response but are not written to the database.
        let thread: { id: string; title: string; user_id: string | null } | null = null;
        if (shouldPersist) {
          if (!sb || !userId) return new Response("Unauthorized", { status: 401, headers: cors });
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

        // --- Daily AI cap per user (UTC) - admins bypass ---
        let isAdmin = false;
        if (sb && userId) {
          const { data: adminRow } = await sb
            .from("user_roles")
            .select("role")
            .eq("user_id", userId)
            .eq("role", "admin")
            .maybeSingle();
          isAdmin = !!adminRow;
        }

        if (sb && userId && !isAdmin) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: usageCount, error: usageErr } = await supabaseAdmin.rpc("bump_ai_usage", { _user_id: userId, _cap: DAILY_AI_CAP });
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
        } else if (userId) {
          console.log(`[chat] req=${reqId} user=${userId} admin=unlimited`);
        } else {
          console.log(`[chat] req=${reqId} public_ephemeral`);
        }

        const journalCtx = buildJournalContext(journal ?? []);

        // If the client didn't attach a live snapshot but we know the ticker,
        // best-effort fetch a spot price server-side so the coach can still
        // ground numeric levels instead of stalling on "waiting for feed".
        let enrichedChart = chart;
        if (chart?.ticker && !chart.snapshot?.lastPrice) {
          try {
            const { getSpotPrice } = await import("@/lib/quote.server");
            const rawTicker = (chart.ticker.match(/\(([^)]+)\)\s*$/)?.[1] ?? chart.ticker).trim();
            const spot = await getSpotPrice(rawTicker);
            if (spot != null) {
              enrichedChart = {
                ...chart,
                snapshot: {
                  ...(chart.snapshot ?? {}),
                  lastPrice: spot,
                  source: "spot",
                  sourceLabel: "Spot quote (server)",
                  fetchedAt: new Date().toISOString(),
                },
              };
            }
          } catch (e) {
            console.warn(`[chat] req=${reqId} spot_enrich_failed`, (e as Error).message);
          }
        }

        const system = systemPrompt(coach, journalCtx, chartContextBlock(enrichedChart), strategyContextBlock(strategy), lensContextBlock(lens));

        const gateway = createAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system,
          messages: await convertToModelMessages(messages),
        });

        return result.toUIMessageStreamResponse({
          headers: { "X-Request-Id": reqId },
          originalMessages: messages,
          onFinish: async ({ messages: finalMessages }) => {
            if (!shouldPersist || !thread) return;
            try {
              if (!sb || !userId) return;
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
