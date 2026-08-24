import { describe, it, expect } from "vitest";
import { outcomeLabel } from "@/hooks/useSignalOutcomes";
import { scoreEvidenceFor } from "@/lib/signal-evidence.server";
import type { SignalScoreRow } from "@/lib/signal-scores.shared";

const row = (over: Partial<SignalScoreRow>): SignalScoreRow =>
  ({
    id: "1", symbol: "XAU/USD", timeframe: "60", grade: "B", bias: "Short",
    entry: 3400, stop: 3410, tp1: 3380, status: "open", realizedR: null,
    createdAt: new Date().toISOString(), taken: false,
  } as unknown as SignalScoreRow);

// Minimal Supabase stub: one chained query that resolves to fixed rows.
const stubClient = (rows: unknown[]) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const k of ["select", "eq", "gt", "order", "limit", "in", "not"]) chain[k] = self;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return { from: () => chain } as never;
};

describe("outcomeLabel", () => {
  it("labels measured outcomes without any journal entry", () => {
    expect(outcomeLabel(row({}))).toEqual({ text: "Still open", tone: "open" });
    expect(outcomeLabel({ ...row({}), status: "target", realizedR: 2 } as SignalScoreRow).tone).toBe("win");
    expect(outcomeLabel({ ...row({}), status: "stop" } as SignalScoreRow).text).toBe("Stopped -1R");
    expect(outcomeLabel(null).text).toBe("Not tracked");
  });
});

describe("counter-trend track record", () => {
  const losing = Array.from({ length: 6 }, (_, i) => ({
    symbol: "XAU/USD", timeframe: "60", grade: "B", bias: "Short",
    status: i < 5 ? "stop" : "target", realized_r: i < 5 ? -1 : 2,
    strategy_id: null, counter_trend: true,
  }));

  it("caps counter-trend setups from measured scan outcomes alone", async () => {
    const ev = await scoreEvidenceFor(stubClient(losing), "u1", "XAU/USD");
    expect(ev.counterCap).toBe("C");
    expect(ev.counterReason).toMatch(/counter-trend/i);
    expect(ev.prompt).toMatch(/Counter-trend scans/);
  });

  it("does not cap when counter-trend calls are paying", async () => {
    const winning = losing.map((r) => ({ ...r, status: "target", realized_r: 2 }));
    const ev = await scoreEvidenceFor(stubClient(winning), "u1", "XAU/USD");
    expect(ev.counterCap).toBeNull();
  });
});
