import { describe, expect, it, vi } from "vitest";
import { hypotheticalPnl } from "@/lib/autopilot-evaluation.shared";
import { logAutopilotEvaluation } from "@/lib/autopilot-evaluation.server";
import type { TradePlan } from "@/lib/agents/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

describe("Autopilot hypothetical setup logging", () => {
  it("shows +100 on a +2R setup risking 50, never as broker profit", () => {
    expect(hypotheticalPnl(2, 50)).toBe(100);
  });
  it("shows -50 on a -1R stop risking 50", () => {
    expect(hypotheticalPnl(-1, 50)).toBe(-50);
  });
  it("does not invent money for historical rows with no recorded risk", () => {
    expect(hypotheticalPnl(2, null)).toBeNull();
  });
  it("logs a pending setup with immutable levels and its exact feed", async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "scan" }, error: null }) }) });
    const client = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient<Database>;
    const plan = { bias: "Long", grade: "B", triggered: false, triggerRule: "Wait for closed reaction", notes: "Draw long",
      confidence: 60, methodologyVersion: "test", entryModel: "liquidity_draw_proximal", liquidityDraw: { feed: "OANDA:api-fxtrade.oanda.com:mid" } } as TradePlan;
    expect(await logAutopilotEvaluation(client, "owner", "US30", "60", plan, { entry: 100, stop: 90, tp1: 120, tp2: 130 }, 50)).toBe("scan");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner", source: "autopilot", entry: 100, stop: 90, tp1: 120,
      status: "open", hypothetical_risk_amount: 50, data_feed: "OANDA:api-fxtrade.oanda.com:mid", refused_reason: "Wait for closed reaction" }));
  });
  it("logs no-entry evaluations without trade levels", async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "scan" }, error: null }) }) });
    const client = { from: () => ({ insert }) } as unknown as SupabaseClient<Database>;
    await logAutopilotEvaluation(client, "owner", "US30", "60", { bias: "Neutral", grade: "NO ENTRY", notes: "No zone" } as TradePlan,
      { entry: 100, stop: 90, tp1: 120, tp2: null }, 0);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: "no_trade", entry: null, stop: null, tp1: null, hypothetical_risk_amount: null }));
  });
});