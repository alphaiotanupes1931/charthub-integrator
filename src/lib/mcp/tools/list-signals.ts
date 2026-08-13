import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_signals",
  title: "List recent AI signals",
  description:
    "List the most recent graded trade signals from the TradeMind signal engine, newest first. Optionally filter by symbol or minimum grade.",
  inputSchema: {
    symbol: z.string().optional().describe("Optional symbol filter, for example GOLD, US30, EUR/USD."),
    limit: z.number().optional().describe("How many signals to return. Default 10, max 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ symbol, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const take = Math.min(Math.max(Math.round(limit ?? 10), 1), 50);
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("signal_feed")
      .select("symbol, grade, bias, action, entry, stop, tp1, rr, confidence, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(take);
    if (symbol?.trim()) query = query.ilike("symbol", `%${symbol.trim()}%`);

    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data?.length) return { content: [{ type: "text", text: "No signals found." }] };

    const lines = data.map(
      (s) =>
        `${s.symbol} ${s.grade ?? "-"} ${s.bias ?? ""} ${s.action ?? ""} entry ${s.entry ?? "-"} stop ${s.stop ?? "-"} tp1 ${s.tp1 ?? "-"} RR ${s.rr ?? "-"} conf ${s.confidence ?? "-"}% (${s.created_at})`,
    );
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { signals: data },
    };
  },
});
