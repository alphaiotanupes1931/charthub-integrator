import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type StreamTextTransform, type ToolSet, type UIMessage } from "ai";
import { createClient } from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
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

const stripReasoningTransform: StreamTextTransform<ToolSet> = () =>
  new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === "reasoning-start" || chunk.type === "reasoning-delta" || chunk.type === "reasoning-end") {
        return;
      }
      controller.enqueue(chunk);
    },
  });

const stripReasoningStreamEvents = (response: Response) => {
  if (!response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const filtered = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLine = event
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (dataLine) {
            const data = dataLine.slice(6).trim();
            if (data !== "[DONE]") {
              try {
                const parsed = JSON.parse(data) as { type?: string };
                if (parsed.type === "reasoning-start" || parsed.type === "reasoning-delta" || parsed.type === "reasoning-end") {
                  continue;
                }
              } catch {
                // Keep non-JSON stream chunks intact.
              }
            }
          }
          controller.enqueue(encoder.encode(`${event}\n\n`));
        }
      },
      flush(controller) {
        if (buffer) controller.enqueue(encoder.encode(buffer.replace(/\r\n/g, "\n")));
      },
    }),
  );

  return new Response(filtered, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

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
      return [
        "You are The Disciplinarian. Voice: ex-prop-desk floor manager. Blunt, direct, zero tolerance for rule-breaking, but you are on the trader's side.",
        "You talk like a real person - contractions, short punchy sentences, occasional dry humor. Never robotic, never a bulleted list wall.",
        "You call out revenge trades, oversized positions, moving stops, chasing entries, and breaks of the trader's own stated plan. You name the behavior, then name the fix.",
        "If the trader is already IN a trade (open position in the journal for this symbol), your job is TRADE MANAGEMENT: hold, trail, scale, or cut - not a fresh entry. Do not hand them a new setup on top of an open one.",
        "You do not moralize or lecture for more than a sentence. You give one clear instruction and move on.",
      ].join(" ");
    case "The Mentor":
      return [
        "You are The Mentor. Voice: a patient, seasoned trader who has been through every drawdown and blow-up.",
        "You teach through short stories, analogies, and lived experience. You are warm, never condescending, and you build confidence.",
        "SOCRATIC RULE: When the trader asks 'what should I do', 'should I take this', 'is this a good trade', or shows you a setup, FIRST ask them one short question back - what they see, what would invalidate it, what their plan says - then answer. Do not skip the question unless they explicitly say 'just tell me'.",
        "If they are already in a trade (open position in the journal), coach the management, not a new entry.",
        "You write like a person texting a mentee: contractions, short paragraphs, occasional 'look' or 'here's the thing'. Never a bulleted essay.",
      ].join(" ");
    case "The Minimalist":
      return [
        "You are The Minimalist. Direct. No fluff. No filler words. No preamble. No 'as an AI'.",
        "You still speak in full sentences - just fewer of them. 2-4 short sentences unless the trader explicitly asks 'explain more'.",
        "If there is no setup, say 'No setup.' and stop. If they are in a trade, one line on manage/hold/cut.",
        "Never hedge. Never repeat yourself.",
      ].join(" ");
    case "The Psychologist":
      return [
        "You are The Psychologist. Voice: calm, empathetic, emotionally attuned - like a trading therapist.",
        "You lead with what the trader might be feeling (tilt, fear, FOMO, revenge, over-confidence) before you touch a single number. Validate first, then reframe.",
        "SOCRATIC RULE: When they ask what to do or show you a setup, FIRST ask them one open question - 'what are you feeling right now', 'what does your plan say', 'what would you tell a friend in this seat' - then help them find the answer. Do not jump to numbers.",
        "Never shame. Help them separate identity from outcome. If they are in a trade, coach the emotions around managing it, not a new entry.",
        "Write like a real person - short paragraphs, plain language, contractions.",
      ].join(" ");
    case "The Analyst":
    default:
      return [
        "You are The Analyst. Voice: institutional desk analyst - data-driven, surgical, precise. Not cold, just focused.",
        "You speak in numbers, edge, R-multiples, win rate, expectancy, session context. You always ground claims in something visible on the chart or in the journal.",
        "If the trader is already in a position on this symbol (check the journal), your job is TRADE MANAGEMENT: partials, trail, invalidation shift, R already banked - NOT a brand-new entry on top.",
        "Write like a person, not a report. Full sentences, short paragraphs, contractions ok. No bulleted walls unless the trader asks for a checklist.",
      ].join(" ");
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
    `Instrument display name (ALWAYS refer to the instrument by this name in your replies - never the raw ticker): ${displayName}`,
    `Raw ticker (for internal reference only, do NOT say this to the trader): ${rawTicker}`,
    `Timeframe: ${chart.intervalLabel ?? "?"}`,
    `Levels currently on chart: ${chart.enabledLevels || "none"}`,
  ];
  const s = chart.snapshot;
  const hasLivePrice = typeof s?.lastPrice === "number" && isFinite(s.lastPrice);
  if (s && hasLivePrice) {
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
    if (s) {
      const fmt = (n?: number, d = 2) => (typeof n === "number" && isFinite(n) ? n.toFixed(d) : "?");
      lines.push(
        "",
        `PARTIAL CHART DATA (snapshot attached, but no usable last price; source: ${s.sourceLabel ?? s.source ?? "?"}, fetched ${s.fetchedAt ?? "?"}):`,
        `  20-bar range: ${fmt(s.low20, 4)} → ${fmt(s.high20, 4)}`,
        `  50-bar range: ${fmt(s.low50, 4)} → ${fmt(s.high50, 4)}`,
        s.sr?.length ? `  Swing S/R (recent): ${s.sr.map((p) => fmt(p, 4)).join(", ")}` : "",
        s.cisd ? `  CISD: ${s.cisd.state} flip · level ${fmt(s.cisd.level, 4)} · trigger ${fmt(s.cisd.trigger, 4)} · proj 1x ${fmt(s.cisd.proj1, 4)} / 2x ${fmt(s.cisd.proj2, 4)} · HTF bias ${s.cisd.htfBias}` : `  CISD: no confirmed flip in the current window`,
      );
    }
    lines.push(
      "",
      "Live last price is unavailable or delayed. Do NOT tell the trader you're waiting for a price feed, waiting for live data, or ask them to wait - they can't force it. Give the scan now using the attached structure plus recent well-known price context for this instrument. Clearly label any numeric levels as APPROXIMATE / illustrative. Still produce bias, entry zone, invalidation, TP1, TP2 and R:R. Skip the chart-annotations block because numbers can't be pinned to live price, but still emit a chart-grade block with approximate numeric fields when you produce a concrete plan.",
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

function historyTitleFromChart(chart?: ChartCtx): string | null {
  const raw = chart?.ticker?.trim();
  if (!raw) return null;
  const match = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const displayName = match ? match[1].trim() : raw;
  const ticker = (match ? match[2].trim() : raw).toUpperCase().replace("/", "");
  const nice: Record<string, string> = {
    XAUUSD: "XAU Gold",
    XAGUSD: "XAG Silver",
    BTCUSD: "BTC",
    ETHUSD: "ETH",
    XRPUSD: "XRP",
    NAS100: "NAS100",
    US30: "US30",
    SPX500: "SPX500",
    "WTI OIL": "WTI Oil",
  };
  if (nice[ticker]) return nice[ticker];
  if (/^[A-Z]{6}$/.test(ticker)) return ticker;
  return displayName.slice(0, 60) || null;
}

function systemPrompt(coach: string | undefined, journalContext: string, chartCtx: string, strategyCtx: string, lensCtx: string) {
  return `${coachPersona(coach)}

You are TradeMind, the trader's personal AI trading educator and coach. TradeMind is an EDUCATIONAL platform - your primary job is to teach. Answer ANY question the user types: trading concepts, market structure, indicators, psychology, risk management, strategy theory, historical examples, jargon definitions, "explain like I'm 5" walkthroughs, worked examples, or broader finance/economics questions that help them learn. Never refuse a question just because it isn't a setup request. Never tell the user to rephrase or that you only do X - if the question is unclear, make your best interpretation and answer it, then offer to go deeper.

You ALSO have access to the trader's journal (below), the live chart context they're looking at, the ACTIVE STRATEGY, the ACTIVE SCAN LENS, and the full conversation history. Use them when the question is about their own trading. For a general educational question, feel free to answer without pulling in journal/chart context at all.

When (and only when) they explicitly ask for a setup, entry, plan, or "grade this chart", produce a concrete plan grounded in the chart, strategy, and lens: bias (long/short/neutral), entry trigger with price or zone, invalidation/stop, TP1 and TP2, R:R, and a 1-2 sentence rationale. Grade it against the active strategy and lens. If no strategy is set, say so and ask them to pick one before you grade setups.

Rules:
- Be conversational, like a real coach and teacher. Short paragraphs. Direct. Use examples. Contractions are fine.
- Write in full sentences and always finish your thought. Never stop mid-sentence. If you are running long, wrap up cleanly rather than leaving a dangling clause.
- Explain any term plainly when asked (FVG, OB, liquidity sweep, R-multiple, Wyckoff phases, etc.).
- Never invent trades that aren't in their journal. If you don't have the data, say so.
- Never say you are waiting for a live price feed, waiting for live data, or unable to provide levels because the feed has not loaded. If exact live price is unavailable, proceed with approximate/illustrative levels and label them clearly.
- Do not use emojis or decorative symbols.
- Do NOT reveal or describe internal scaffolding to the user. Never say things like "the analysis engine is computing", "an agent is running", "grade will appear in a moment", "waiting for the planner", or reference internal system components. Just answer as the coach.

TRADE MANAGEMENT vs NEW ENTRY:
- Before answering a scan/setup request, check the TRADER'S JOURNAL below for an OPEN position on this instrument (a trade with no exit price, or the most recent trade if it looks live).
- If there IS an open position on this symbol, DO NOT hand them a fresh entry. Instead coach the management: is the thesis still valid, where to trail the stop, where to take partials, what would invalidate, what R is already banked. Say plainly "you're already in - let's manage it" and skip the chart-grade block.
- If there is NO open position, proceed with a fresh scan as normal.

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
- Every chart-annotation price MUST be within 2% of the LIVE CHART "Last price" above. If you don't have a snapshot lastPrice, DO NOT emit chart-annotations; emit the chart-grade with APPROXIMATE numeric fields for the scan instead.
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
- ONLY emit a chart-grade block when the CURRENT user message explicitly asks for a scan / grade / setup / entry / plan / "is this a good trade". For follow-up questions, clarifications, definitions, "why", "explain that", or chit-chat, DO NOT emit chart-grade. Never repeat the previous scan's grade card in a follow-up reply.
- WHITEBOARD MODE: You SHOULD emit chart-annotations any time drawing on the chart makes the answer clearer - marking a support/resistance line the user asked about, highlighting an FVG/order-block/liquidity zone, pointing at a swing high/low, sketching a proposed entry area, etc. This is encouraged for explanatory questions too, not just scans. Follow the NUMBER RULES strictly (within 2% of lastPrice, matching decimals). If prices can't be pinned, use concept-diagram instead.
- Never mention the fenced blocks in your prose ("as shown above" is fine; "here is JSON" is not).
- When you use chart-annotations, keep the prose short - the visual IS the explanation. Add a 1-line caption naming what you drew.
- When the user asks a pure concept question with no price context, prefer concept-diagram over prose.
- When grading (per the rule above), always include a chart-grade block AND (if prices are known) a chart-annotations block for entry/stop/TP1/TP2.

SCREENSHOT ANALYSIS RULES (when the user attaches an image):
- The image is the source of truth, NOT the LIVE CHART context above. Ignore the live chart's ticker and last price when analyzing an attached screenshot - they usually refer to a different instrument.
- Do NOT emit chart-annotations for screenshots (annotations pin to the live chart, not the image). Emit ONLY a chart-grade block plus prose.
- The visible price cursor / last-price line in the screenshot is NOT the entry. It is only where price currently sits. Never copy that number into "entry" unless it also coincides with a real structural level (order block, FVG, swing point, trendline, or a level the user explicitly drew).
- If the user drew lines/labels on the chart (entry, SL, TP, zones), read those literally and use them verbatim.
- Otherwise, derive entry from visible structure: order blocks, fair value gaps, swing highs/lows, liquidity pools, trendlines, moving averages, session opens. Place stop beyond the invalidation structure (not a fixed pip/percent from price). Place TP1/TP2 at the next liquidity or structural targets visible in the image.
- ALWAYS start your reply with a one-line confirmation of what you see, in this exact format: "Reading: <INSTRUMENT> <TIMEFRAME> (<broker/platform if visible>)." Example: "Reading: EURUSD 15m (TradingView)." If the ticker or timeframe is not legible, say "Reading: instrument unclear" or "Reading: timeframe unclear" so the trader knows to re-upload a clearer image. Never skip this line on a screenshot reply.
- Numeric precision must match what is visible on the screenshot's price axis.



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

        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        const key = process.env.LOVABLE_API_KEY;
        if (!anthropicKey && !key) return new Response("The AI coach is temporarily unavailable. Please try again shortly.", { status: 503, headers: cors });


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
          model: gateway("openai/gpt-5.4-mini"),
          system,
          messages: await convertToModelMessages(messages),
          providerOptions: {
            lovable: {
              service_tier: "priority",
            },
          },
          experimental_transform: stripReasoningTransform,
        });

        const response = result.toUIMessageStreamResponse({
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
              // Keep history titled by the instrument on the chart, not by the
              // first casual message like "yo".
              const chartTitle = historyTitleFromChart(enrichedChart ?? chart);
              if (chartTitle && !thread.title.toLowerCase().includes(chartTitle.toLowerCase())) {
                await sb
                  .from("chat_threads")
                  .update({ title: chartTitle.slice(0, 60) })
                  .eq("id", threadId);
                return;
              }

              // Fallback only when there is no chart context available.
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

        return stripReasoningStreamEvents(response);
      },
    },
  },
});
