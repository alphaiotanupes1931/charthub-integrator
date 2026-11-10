import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_AUTOPILOT_SETTINGS } from "@/lib/autopilot.shared";
import { runAutopilotForUser } from "@/lib/autopilot-run.server";

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  manage: vi.fn(),
  place: vi.fn(),
  log: vi.fn(),
  facts: vi.fn(),
}));
vi.mock("@/lib/autopilot.server", () => ({ buildProposalDraft: mocks.build }));
vi.mock("@/lib/autopilot-events.server", () => ({ logAutopilotEvent: mocks.log }));
vi.mock("@/lib/notifications.server", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/auto-trade.server", () => ({ liveAccountFacts: mocks.facts }));
vi.mock("@/lib/autopilot-live.server", () => ({
  manageLiveTrades: mocks.manage,
  placeLiveOrder: mocks.place,
  cancelStaleTradeLockerLimits: async () => 0,
}));

function clientWithHourlyFills(hourlyFills: number) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ count: hourlyFills }),
    in: vi.fn().mockResolvedValue({ count: 4 }),
    then: (resolve: (value: { data: never[] }) => unknown) =>
      Promise.resolve({ data: [] }).then(resolve),
  };
  return { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
}

describe("demo schedule only gates new entries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.facts.mockResolvedValue({ connected: true, dailyLossPct: 0, equity: 10000, openPositions: 1 });
    mocks.manage.mockResolvedValue({ movedToBreakEven: 1, partialsTaken: 0, trailed: 0, notes: [] });
    mocks.build.mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ["before 9 AM", "2026-11-03T13:59:00Z"],
    ["after 5 PM", "2026-11-03T22:30:00Z"],
    ["overnight", "2026-11-04T05:30:00Z"],
    ["weekend", "2026-11-07T15:00:00Z"],
  ])("manages open trades %s without scanning or placing orders", async (_name, time) => {
    vi.setSystemTime(new Date(time));
    const result = await runAutopilotForUser(clientWithHourlyFills(0), "test-user", {
      ...DEFAULT_AUTOPILOT_SETTINGS, mode: "auto", demoOnly: true,
    }, "60", "test-key");
    expect(result.scanned).toBe(0);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.place).not.toHaveBeenCalled();
    expect(mocks.manage).toHaveBeenCalledWith("test-user", expect.any(String), {
      breakEven: true, partials: true, trail: true,
    });
    expect(mocks.log).toHaveBeenCalledWith("test-user", "run", expect.any(String), expect.objectContaining({ scanned: 0, executed: 0 }));
  });

  it("continues management when this hour already has a filled trade", async () => {
    vi.setSystemTime(new Date("2026-11-03T21:45:00Z"));
    const result = await runAutopilotForUser(clientWithHourlyFills(1), "test-user", {
      ...DEFAULT_AUTOPILOT_SETTINGS, mode: "auto", demoOnly: true,
    }, "60", "test-key");
    expect(result.scanned).toBe(0);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.place).not.toHaveBeenCalled();
    expect(mocks.manage).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith("test-user", "run", expect.any(String), expect.objectContaining({ executed: 0 }));
  });

  it("still scans in an unused 4 PM slot", async () => {
    vi.setSystemTime(new Date("2026-11-03T21:05:00Z"));
    const result = await runAutopilotForUser(clientWithHourlyFills(0), "test-user", {
      ...DEFAULT_AUTOPILOT_SETTINGS, mode: "auto", demoOnly: true, allowedSymbols: ["EUR/USD"],
    }, "60", "test-key");
    expect(result.scanned).toBe(1);
    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(mocks.manage).toHaveBeenCalledTimes(1);
  });
  it("rescans a pending symbol and retires the stale entry after a no-entry evaluation", async () => {
    vi.setSystemTime(new Date("2026-11-03T21:05:00Z"));
    const update = vi.fn().mockReturnThis();
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), update,
      gte: vi.fn().mockResolvedValue({ count: 0 }), in: vi.fn().mockResolvedValue({ count: 0 }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ symbol: "US30", expires_at: "2026-11-04T00:00:00Z" }], error: null }).then(resolve),
    };
    update.mockReturnValue(query);
    const client = { from: () => query } as unknown as SupabaseClient<Database>;
    await runAutopilotForUser(client, "test-user", { ...DEFAULT_AUTOPILOT_SETTINGS, mode: "auto", demoOnly: true, allowedSymbols: ["US30"] }, "60", "test-key");
    expect(mocks.build).toHaveBeenCalledWith("test-key", "US30", "60", expect.any(Object), 10000, { client, userId: "test-user" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: "expired", rejection_reason: "Superseded by a fresh scan" }));
    expect(mocks.place).not.toHaveBeenCalled();
  });
});