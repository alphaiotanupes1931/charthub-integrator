import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_market_price",
  title: "Get live market price",
  description:
    "Get the live OANDA price and key technical stats (ATR, 20-bar range) for a symbol on a timeframe.",
  inputSchema: {
    symbol: z.string().describe("Symbol, for example GOLD, XAU/USD, US30, NAS100, EUR/USD, BTC/USD."),
    interval: z
      .string()
      .optional()
      .describe("Timeframe such as 15m, 1h, 4h, 1d. Defaults to 1h."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ symbol, interval }) => {
    const { getSnapshot } = await import("@/lib/agents/market-data.server");
    let snap;
    try {
      snap = await getSnapshot(symbol, interval?.trim() || "1h");
    } catch (err) {
      throw new ToolError(
        `Could not load a price feed for "${symbol}": ${(err as Error)?.message ?? "unknown error"}`,
      );
    }
    const text = [
      `${snap.ticker} ${snap.interval}`,
      `Last: ${snap.lastPrice}`,
      `ATR14: ${snap.stats.atr14}`,
      `20-bar range: ${snap.stats.low20} - ${snap.stats.high20}`,
    ].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        ticker: snap.ticker,
        interval: snap.interval,
        lastPrice: snap.lastPrice,
        stats: snap.stats,
      },
    };
  },
});
