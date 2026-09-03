import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** One closed position read out of a broker / platform screenshot. */
export type ParsedClosedTrade = {
  symbol: string;
  side: "Long" | "Short";
  entry: number | null;
  exit: number | null;
  stop: number | null;
  takeProfit: number | null;
  size: number | null;
  pnl: number | null;
  fees: number | null;
  date: string | null;
  timeframe: string | null;
  notes: string | null;
  confidence: number | null;
};

export type ParseClosedTradesResult = {
  trades: ParsedClosedTrade[];
  note: string;
};

const TradeSchema = z.object({
  symbol: z.string().nullish(),
  side: z.string().nullish(),
  entry: z.number().nullish(),
  exit: z.number().nullish(),
  stop: z.number().nullish(),
  takeProfit: z.number().nullish(),
  size: z.number().nullish(),
  pnl: z.number().nullish(),
  fees: z.number().nullish(),
  date: z.string().nullish(),
  timeframe: z.string().nullish(),
  notes: z.string().nullish(),
  confidence: z.number().nullish(),
});

const OutSchema = z.object({
  trades: z.array(TradeSchema).nullish(),
  note: z.string().nullish(),
});

// Five frames per read covers the 4H / 1H / 15m / 5m / 1m stack a trader pastes.
const MAX_IMAGES = 5;
const MAX_CHARS = 6_000_000; // ~4.5MB of base64 per request

/**
 * Ask the model for JSON and parse it ourselves. The gateway's Gemini route
 * does not honour provider structured output, so a schema-constrained call
 * comes back as prose and throws. Requesting raw JSON works on every model.
 */
async function readJson<T>(
  schema: { parse: (v: unknown) => T },
  args: { apiKey: string; system: string; messages: any[] },
): Promise<T> {
  const { generateText } = await import("ai");
  const { createAiGatewayProvider } = await import("@/lib/ai-gateway.server");
  const model = createAiGatewayProvider(args.apiKey)("google/gemini-3.7-flash");
  let last = "";
  // The model occasionally answers in prose or truncates the object; one retry
  // with a blunter instruction clears almost every case.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateText({
      model,
      system:
        `${args.system} Reply with a single minified JSON object only. No prose, no explanation, no markdown fences.` +
        (attempt === 0 ? "" : " Your previous reply was not valid JSON. Output only the JSON object now."),
      messages: args.messages,
    });
    const text = res.text || "";
    last = text.slice(0, 200);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return schema.parse(JSON.parse(text.slice(start, end + 1)));
    } catch {
      continue;
    }
  }
  console.warn("[journal-import] unparsable model reply", last);
  throw new Error("NO_JSON");

}


/**
 * Read closed positions out of one or more screenshots (broker history, MT5
 * "closed positions", TradingView trade list) so they can be logged in the
 * journal without retyping every number.
 */
export const parseClosedTradesScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { images: string[]; hint?: string }) =>
    z
      .object({
        images: z.array(z.string().min(32)).min(1).max(MAX_IMAGES),
        hint: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ParseClosedTradesResult> => {
    const total = data.images.reduce((n, i) => n + i.length, 0);
    if (total > MAX_CHARS) {
      return { trades: [], note: "Those screenshots are too large. Crop them to the closed-trades list and try again." };
    }

    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) {
      return { trades: [], note: "Screenshot reading is not configured on this deployment." };
    }

    try {
      const out = await readJson(OutSchema, {
        apiKey,
        system: [
          "You read screenshots of trading platform history and extract CLOSED trades only.",
          "Return one entry per closed position. Skip open positions, pending orders, deposits, withdrawals and totals rows.",
          "Copy numbers exactly as printed. Never invent a value: use null when a field is not visible.",
          "side must be exactly 'Long' or 'Short' (buy = Long, sell = Short).",
          "date must be YYYY-MM-DD in the timezone shown on the screenshot; use the close date when both open and close are shown.",
          "pnl is the net profit or loss in account currency, negative for a loss.",
          "symbol is the instrument ticker as printed, uppercase, no broker suffix noise.",
          "confidence is 0-1: how sure you are that this row was read correctly.",
          "note is one short plain sentence about what you saw, no emoji, no marketing tone.",
          'Shape: {"trades":[{"symbol":"","side":"Long","entry":0,"exit":0,"stop":null,"takeProfit":null,"size":null,"pnl":null,"fees":null,"date":null,"timeframe":null,"notes":null,"confidence":0.9}],"note":""}',
        ].join(" "),
        messages: [
          {
            role: "user",
            content: [
              ...data.images.map((image) => ({ type: "image" as const, image })),
              {
                type: "text" as const,
                text: `Extract every closed trade from these screenshots.${data.hint ? ` Trader note: ${data.hint}` : ""}`,
              },
            ],
          },
        ],
      });

      const trades: ParsedClosedTrade[] = (out.trades ?? []).slice(0, 60).map((t) => ({
        symbol: (t.symbol || "").toUpperCase().slice(0, 24),
        side: /short|sell/i.test(t.side || "") ? "Short" : "Long",
        entry: t.entry ?? null,
        exit: t.exit ?? null,
        stop: t.stop ?? null,
        takeProfit: t.takeProfit ?? null,
        size: t.size ?? null,
        pnl: t.pnl ?? null,
        fees: t.fees ?? null,
        date: t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
        timeframe: t.timeframe ? t.timeframe.slice(0, 6) : null,
        notes: t.notes ? t.notes.slice(0, 300) : null,
        confidence: t.confidence ?? null,
      }));

      return {
        trades: trades.filter((t) => t.symbol),
        note: (out.note || "Read the closed trades off that screenshot.").slice(0, 300),
      };
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      if (/NO_JSON|JSON|invalid_type|Unexpected/i.test(raw)) {
        return { trades: [], note: "The screenshot could not be read. Crop tighter to the closed-trades table and retry." };
      }
      const message = e instanceof Error ? e.message : "";
      if (/429/.test(message)) return { trades: [], note: "Too many requests right now. Wait a moment and retry." };
      if (/402/.test(message)) return { trades: [], note: "AI credits are exhausted for this workspace." };
      return { trades: [], note: "The screenshot reader is unavailable right now. Try again shortly." };
    }
  });

/** One planned/open setup read out of a chart screenshot (TradingView etc.). */
export type ParsedTradeSetup = {
  symbol: string | null;
  side: "Long" | "Short" | null;
  timeframe: string | null;
  entry: number | null;
  stop: number | null;
  takeProfit: number | null;
  exit: number | null;
  size: number | null;
  notes: string | null;
  confidence: number | null;
  note: string;
};

const SetupSchema = z.object({
  symbol: z.string().nullish(),
  side: z.string().nullish(),
  timeframe: z.string().nullish(),
  entry: z.number().nullish(),
  stop: z.number().nullish(),
  takeProfit: z.number().nullish(),
  exit: z.number().nullish(),
  size: z.number().nullish(),
  notes: z.string().nullish(),
  confidence: z.number().nullish(),
  note: z.string().nullish(),
});

const EMPTY_SETUP: ParsedTradeSetup = {
  symbol: null, side: null, timeframe: null, entry: null, stop: null,
  takeProfit: null, exit: null, size: null, notes: null, confidence: null, note: "",
};

/**
 * Read the numbers off a chart screenshot (TradingView long/short position
 * tool, broker order ticket) so the journal form can be filled in without
 * retyping entry, stop and target by hand.
 */
export const parseTradeSetupScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { images: string[]; hint?: string }) =>
    z
      .object({
        images: z.array(z.string().min(32)).min(1).max(MAX_IMAGES),
        hint: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<ParsedTradeSetup> => {
    const total = data.images.reduce((n, i) => n + i.length, 0);
    if (total > MAX_CHARS) {
      return { ...EMPTY_SETUP, note: "That screenshot is too large. Crop it to the chart and try again." };
    }

    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ...EMPTY_SETUP, note: "Screenshot reading is not configured on this deployment." };

    try {
      const o = await readJson(SetupSchema, {
        apiKey,
        system: [
          "You read a single trading chart screenshot (usually TradingView) and extract the trade levels shown on it.",
          "The symbol and timeframe are normally printed in the top-left corner; keep the symbol as printed, uppercase.",
          "timeframe must be one of 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W when it can be read, otherwise null.",
          "If a long/short position tool is drawn: the entry line is the middle line, the red/loss zone is the stop, the green/profit zone is the target.",
          "A green profit zone above the entry means side is Long; below the entry means Short. Buy/long labels are Long, sell/short labels are Short.",
          "Read prices off the price axis or the printed labels. Copy digits exactly and respect the instrument's decimal places.",
          "exit is only set when the screenshot clearly shows the trade already closed at a price; otherwise null.",
          "Never invent a value: use null for anything not visible on the image.",
          "notes is at most two short factual sentences about what the chart shows, no emoji, no hype.",
          "confidence is 0-1 for how reliably the levels were read.",
          "note is one short plain sentence about what you read.",
          'Shape: {"symbol":"","side":"Long","timeframe":"4H","entry":0,"stop":0,"takeProfit":0,"exit":null,"size":null,"notes":null,"confidence":0.9,"note":""}',
        ].join(" "),
        messages: [
          {
            role: "user",
            content: [
              ...data.images.map((image) => ({ type: "image" as const, image })),
              {
                type: "text" as const,
                text: `Read the symbol, timeframe, direction, entry, stop and target off this chart.${data.hint ? ` Trader note: ${data.hint}` : ""}`,
              },
            ],
          },
        ],
      });

      const tf = (o.timeframe || "").trim();
      return {
        symbol: o.symbol ? o.symbol.toUpperCase().slice(0, 24) : null,
        side: o.side ? (/short|sell/i.test(o.side) ? "Short" : "Long") : null,
        timeframe: /^(1m|5m|15m|30m|1H|4H|1D|1W)$/i.test(tf) ? tf : null,
        entry: o.entry ?? null,
        stop: o.stop ?? null,
        takeProfit: o.takeProfit ?? null,
        exit: o.exit ?? null,
        size: o.size ?? null,
        notes: o.notes ? o.notes.slice(0, 300) : null,
        confidence: o.confidence ?? null,
        note: (o.note || "").slice(0, 300),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/NO_JSON|JSON|invalid_type|Unexpected/i.test(message)) {
        return { ...EMPTY_SETUP, note: "That chart could not be read. Crop tighter to the position tool and retry." };
      }
      if (/429/.test(message)) return { ...EMPTY_SETUP, note: "Too many requests right now. Wait a moment and retry." };
      if (/402/.test(message)) return { ...EMPTY_SETUP, note: "AI credits are exhausted for this workspace." };
      return { ...EMPTY_SETUP, note: "The screenshot reader is unavailable right now. Try again shortly." };
    }
  });

/**
 * Same extraction as the screenshot reader, but from pasted text: a broker
 * fill confirmation, a Discord signal, or a trader's own write-up.
 */
export const parseTradeSetupText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) =>
    z.object({ text: z.string().min(4).max(4000) }).parse(input),
  )
  .handler(async ({ data }): Promise<ParsedTradeSetup> => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) return { ...EMPTY_SETUP, note: "Text reading is not configured on this deployment." };

    try {
      const o = await readJson(SetupSchema, {
        apiKey,
        system: [
          "You read pasted trading text (broker fill, signal message, or a trader's own notes) and extract the trade levels.",
          "Keep the symbol as written, uppercase.",
          "timeframe must be one of 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W when stated, otherwise null.",
          "side is Long for buy/long wording and Short for sell/short wording.",
          "Copy prices exactly as written, respecting decimals. If several targets are listed use the first one as takeProfit.",
          "exit is only set when the text says the trade was already closed at a price; otherwise null.",
          "Never invent a value: use null for anything not stated.",
          "notes is at most two short factual sentences, no emoji, no hype.",
          "confidence is 0-1 for how reliably the values were read. note is one short plain sentence.",
          'Shape: {"symbol":"","side":"Long","timeframe":"4H","entry":0,"stop":0,"takeProfit":0,"exit":null,"size":null,"notes":null,"confidence":0.9,"note":""}',
        ].join(" "),
        messages: [{ role: "user", content: `Extract the trade details from this text:\n\n${data.text}` }],
      });

      const tf = (o.timeframe || "").trim();
      return {
        symbol: o.symbol ? o.symbol.toUpperCase().slice(0, 24) : null,
        side: o.side ? (/short|sell/i.test(o.side) ? "Short" : "Long") : null,
        timeframe: /^(1m|5m|15m|30m|1H|4H|1D|1W)$/i.test(tf) ? tf : null,
        entry: o.entry ?? null,
        stop: o.stop ?? null,
        takeProfit: o.takeProfit ?? null,
        exit: o.exit ?? null,
        size: o.size ?? null,
        notes: o.notes ? o.notes.slice(0, 300) : null,
        confidence: o.confidence ?? null,
        note: (o.note || "").slice(0, 300),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/NO_JSON|JSON|invalid_type|Unexpected/i.test(message)) {
        return { ...EMPTY_SETUP, note: "No trade details could be read from that text." };
      }
      if (/429/.test(message)) return { ...EMPTY_SETUP, note: "Too many requests right now. Wait a moment and retry." };
      if (/402/.test(message)) return { ...EMPTY_SETUP, note: "AI credits are exhausted for this workspace." };
      return { ...EMPTY_SETUP, note: "The text reader is unavailable right now. Try again shortly." };
    }
  });
