import { describe, it, expect, vi } from "vitest";
import { savedDrawRisk } from "@/lib/draw-order-risk.server";
import { sizeFromRisk } from "@/lib/auto-trade.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function client(multiplier: number, entry = 28008) {
  const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({data:{entry_model:"liquidity_draw_proximal",entry,stop:27958,created_at:new Date().toISOString(),liquidity_draw:{sizeMultiplier:multiplier}},error:null}) };
  return {from:vi.fn(()=>q)} as unknown as SupabaseClient<Database>;
}
describe("authoritative draw risk",()=>{
  it("half-size draw uses 0.25% of a 10k account when configured risk is 0.5%",async()=>{
    const m=await savedDrawRisk(client(0.5),"owner","NAS100",28008,27958);
    expect(m).toBe(0.5); expect(sizeFromRisk(10000,0.5*m,28008,27958)).toBeNull();
    expect(sizeFromRisk(10000,1*m,28008,27958)).toBe(1);
  });
  it("does not exceed reduced-risk budget by rounding up one unit",()=>{
    expect(sizeFromRisk(10000,0.125,28008,27958)).toBeNull();
  });
  it("rejects order levels different from the owner’s saved draw",async()=>{
    await expect(savedDrawRisk(client(0.5),"owner","NAS100",28195.20,27958)).rejects.toThrow();
  });
  it("rejects an invalid multiplier rather than taking full risk",async()=>{
    await expect(savedDrawRisk(client(5),"owner","NAS100",28008,27958)).rejects.toThrow();
  });
});