import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_price_alert",
  title: "Create a price alert",
  description:
    "Create a price alert on the signed-in trader's TradeMind account that fires when a symbol crosses above or below a price.",
  inputSchema: {
    symbol: z.string().describe("Symbol, for example GOLD, US30, EUR/USD."),
    side: z.enum(["above", "below"]).describe("Fire when price goes above or below the level."),
    price: z.number().describe("Price level to watch."),
    note: z.string().optional().describe("Optional note shown with the alert."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ symbol, side, price, note }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("price_alerts")
      .insert({ user_id: ctx.getUserId(), symbol: symbol.trim(), side, price, note: note ?? null })
      .select("id, symbol, side, price, note, active, created_at");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Alert set: ${symbol.trim()} ${side} ${price}` }],
      structuredContent: { alert: data?.[0] },
    };
  },
});
