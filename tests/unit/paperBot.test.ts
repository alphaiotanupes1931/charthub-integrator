// Phase 6: paper-bot decision logic is deterministic and the module boundary
// guarantees no live venue code is reachable from the bot path.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideBotAction, gradeMeets } from "@/lib/paper-bot.server";
import type { PaperBotTradeRow } from "@/lib/paper-bot.server";
import type { ScanResult } from "@/lib/agents/biasEngine";

const scan = (over: Partial<ScanResult>): ScanResult =>
  ({
    bias: "bullish",
    grade: "A",
    status: "READY TO PLACE LIMIT",
    entry: 100,
    stop: 95,
    targets: [110],
    notes: [],
    ...over,
  }) as unknown as ScanResult;

const trade = (over: Partial<PaperBotTradeRow> = {}): PaperBotTradeRow => ({
  id: "t1",
  bot_id: "b1",
  symbol: "XAU/USD",
  side: "long",
  entry: 100,
  stop: 95,
  tp1: 110,
  grade: "A",
  status: "open",
  result: null,
  realized_r: null,
  exit_price: null,
  opened_at: "2026-09-10T10:00:00.000Z",
  closed_at: null,
  ...over,
});

describe("gradeMeets", () => {
  it("ranks grades correctly", () => {
    expect(gradeMeets("A+", "A")).toBe(true);
    expect(gradeMeets("A", "A")).toBe(true);
    expect(gradeMeets("B", "A")).toBe(false);
    expect(gradeMeets("C", "B")).toBe(false);
    expect(gradeMeets("NO ENTRY", "B")).toBe(false);
  });
});

describe("decideBotAction — entries", () => {
  it("enters when a qualifying READY scan exists and nothing is open", () => {
    const d = decideBotAction({ scan: scan({}), openTrade: null, candlesAfterOpen: [], minGrade: "A", lastPrice: 101 });
    expect(d.kind).toBe("enter");
    if (d.kind === "enter") {
      expect(d.side).toBe("long");
      expect(d.entry).toBe(100);
      expect(d.stop).toBe(95);
      expect(d.tp1).toBe(110);
    }
  });

  it("skips B-grade setups on an A-minimum bot", () => {
    const d = decideBotAction({ scan: scan({ grade: "B" }), openTrade: null, candlesAfterOpen: [], minGrade: "A", lastPrice: 101 });
    expect(d.kind).toBe("skip");
  });

  it("gates on the raw engine grade so a display ceiling cannot freeze a bot", () => {
    // US30 / GBP/USD etc. are capped at B for display; the engine still graded A.
    const d = decideBotAction({
      scan: scan({ grade: "B" }), gateGrade: "A",
      openTrade: null, candlesAfterOpen: [], minGrade: "A", lastPrice: 101,
    });
    expect(d.kind).toBe("enter");
    if (d.kind === "enter") expect(d.grade).toBe("A");
  });

  it("skips NO SETUP and PENDING CONFIRMATION passes instead of forcing entries", () => {
    const noSetup = decideBotAction({
      scan: scan({ status: "NO SETUP", notes: ["Neutral: 4H range."] }),
      openTrade: null, candlesAfterOpen: [], minGrade: "A", lastPrice: 101,
    });
    expect(noSetup).toMatchObject({ kind: "skip", reason: "Neutral: 4H range." });

    const pending = decideBotAction({
      scan: scan({ status: "PENDING CONFIRMATION" }),
      openTrade: null, candlesAfterOpen: [], minGrade: "A", lastPrice: 101,
    });
    expect(pending.kind).toBe("skip");
  });

  it("skips scans without an executable entry/stop pair", () => {
    const d = decideBotAction({
      scan: scan({ entry: undefined, stop: undefined }),
      openTrade: null, candlesAfterOpen: [], minGrade: "A", lastPrice: 101,
    });
    expect(d.kind).toBe("skip");
  });
});

describe("decideBotAction — exits", () => {
  it("resolves a long stop loss from closed candles", () => {
    const d = decideBotAction({
      scan: scan({}), openTrade: trade(), minGrade: "A", lastPrice: 96,
      candlesAfterOpen: [{ time: 1, high: 101, low: 94 }],
    });
    expect(d).toMatchObject({ kind: "exit", result: "sl", exitPrice: 95, realizedR: -1 });
  });

  it("resolves a long target from closed candles", () => {
    const d = decideBotAction({
      scan: scan({}), openTrade: trade(), minGrade: "A", lastPrice: 109,
      candlesAfterOpen: [{ time: 1, high: 111, low: 99 }],
    });
    expect(d).toMatchObject({ kind: "exit", result: "tp", exitPrice: 110, realizedR: 2 });
  });

  it("counts the stop first when one candle touches both", () => {
    const d = decideBotAction({
      scan: scan({}), openTrade: trade(), minGrade: "A", lastPrice: 100,
      candlesAfterOpen: [{ time: 1, high: 112, low: 90 }],
    });
    expect(d).toMatchObject({ kind: "exit", result: "sl" });
  });

  it("resolves short exits with the correct sign", () => {
    const short = trade({ side: "short", entry: 100, stop: 105, tp1: 90 });
    const d = decideBotAction({
      scan: scan({}), openTrade: short, minGrade: "A", lastPrice: 91,
      candlesAfterOpen: [{ time: 1, high: 99, low: 89 }],
    });
    expect(d).toMatchObject({ kind: "exit", result: "tp", exitPrice: 90, realizedR: 2 });
  });

  it("reports manage while a trade is still open and untouched", () => {
    const d = decideBotAction({
      scan: scan({}), openTrade: trade(), minGrade: "A", lastPrice: 103,
      candlesAfterOpen: [{ time: 1, high: 104, low: 98 }],
    });
    expect(d.kind).toBe("manage");
  });
});

describe("paper-only isolation boundary", () => {
  it("the bot module never imports venue, broker, or autopilot code", () => {
    const src = readFileSync(resolve(__dirname, "../../src/lib/paper-bot.server.ts"), "utf8");
    expect(src).not.toMatch(/venues\//);
    expect(src).not.toMatch(/broker-trade/);
    expect(src).not.toMatch(/autopilot-live/);
    expect(src).not.toMatch(/placeOrder|createOrder/);
  });
});
