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
  symbol: z.string(),
  side: z.string(),
  entry: z.number().nullable(),
  exit: z.number().nullable(),
  stop: z.number().nullable(),
  takeProfit: z.number().nullable(),
  size: z.number().nullable(),
  pnl: z.number().nullable(),
  fees: z.number().nullable(),
  date: z.string().nullable(),
  timeframe: z.string().nullable(),
  notes: z.string().nullable(),
  confidence: z.number().nullable(),
});

const OutSchema = z.object({
  trades: z.array(TradeSchema),
  note: z.string(),
});

const MAX_IMAGES = 4;
const MAX_CHARS = 6_000_000; // ~4.5MB of base64 per request

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

    const { generateText, Output, NoObjectGeneratedError } = await import("ai");
    const { createAiGatewayProvider } = await import("@/lib/ai-gateway.server");

    try {
      const res = await generateText({
        model: createAiGatewayProvider(apiKey)("google/gemini-3.7-flash"),
        output: Output.object({ schema: OutSchema }),
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

      const trades: ParsedClosedTrade[] = res.output.trades.slice(0, 60).map((t) => ({
        symbol: (t.symbol || "").toUpperCase().slice(0, 24),
        side: /short|sell/i.test(t.side) ? "Short" : "Long",
        entry: t.entry,
        exit: t.exit,
        stop: t.stop,
        takeProfit: t.takeProfit,
        size: t.size,
        pnl: t.pnl,
        fees: t.fees,
        date: t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : null,
        timeframe: t.timeframe ? t.timeframe.slice(0, 6) : null,
        notes: t.notes ? t.notes.slice(0, 300) : null,
        confidence: t.confidence,
      }));

      return {
        trades: trades.filter((t) => t.symbol),
        note: res.output.note.slice(0, 300),
      };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) {
        return { trades: [], note: "The screenshot could not be read. Crop tighter to the closed-trades table and retry." };
      }
      const message = e instanceof Error ? e.message : "";
      if (/429/.test(message)) return { trades: [], note: "Too many requests right now. Wait a moment and retry." };
      if (/402/.test(message)) return { trades: [], note: "AI credits are exhausted for this workspace." };
      return { trades: [], note: "The screenshot reader is unavailable right now. Try again shortly." };
    }
  });
