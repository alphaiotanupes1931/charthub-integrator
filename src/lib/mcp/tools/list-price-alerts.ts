import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_price_alerts",
  title: "List price alerts",
  description: "List the signed-in trader's TradeMind price alerts, newest first.",
  inputSchema: {
    activeOnly: z.boolean().optional().describe("Only return alerts that have not fired yet. Default true."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ activeOnly }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("price_alerts")
      .select("id, symbol, side, price, note, active, triggered_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (activeOnly !== false) query = query.eq("active", true);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data?.length) return { content: [{ type: "text", text: "No alerts." }] };
    const text = data
      .map((a) => `${a.symbol} ${a.side} ${a.price}${a.triggered_at ? " (fired)" : ""}${a.note ? ` - ${a.note}` : ""}`)
      .join("\n");
    return { content: [{ type: "text", text }], structuredContent: { alerts: data } };
  },
});
