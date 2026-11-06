import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  facts: vi.fn(), claim: vi.fn(), insert: vi.fn(), place: vi.fn(), journal: vi.fn(),
  quote: vi.fn(), session: vi.fn(), risk: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({
  middleware() { return this; }, inputValidator() { return this; },
  handler(fn: unknown) { return fn; },
}) }));
vi.mock("@/lib/capability-middleware", () => ({ requireCapability: () => null }));
vi.mock("@/lib/coach-actions.server", () => ({ coachAccountFacts: mocks.facts }));
vi.mock("@/lib/broker-crypto.server", () => ({ encryptSecret: (v: string) => v, decryptSecret: (v: string) => v }));
vi.mock("@/lib/draw-order-risk.server", () => ({ savedDrawRisk: mocks.risk }));
vi.mock("@/lib/journal-auto.server", () => ({ journalPlacedTrade: mocks.journal }));
vi.mock("@/lib/venues/tradelocker.server", () => ({ tradeLockerSession: mocks.session,
  tradeLockerInstrument: vi.fn().mockResolvedValue({}), tradeLockerQuote: mocks.quote, tradeLockerPlaceOrder: mocks.place }));

import { confirmCoachTrade, prepareCoachTrade } from "@/lib/coach-actions.functions";

const userId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const account = { broker: "tradelocker" as const, accountId: "demo1", env: "demo" };
const plan = { symbol: "XAU/USD", side: "long" as const, grade: "B" as const, entry: 4000, stop: 3990, target: 4020 };
function db() {
  const query = {
    insert: mocks.insert, update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: mocks.claim,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return { from: () => query };
}
function token(overrides = {}) {
  return JSON.stringify({ userId, proposalId, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), account, plan, units: 25, riskPct: 0.5, ...overrides });
}
// The framework mock exposes real server handlers; no broker request leaves this test.
const confirm = confirmCoachTrade as unknown as (input: unknown) => Promise<{ orderId: string }>;
const prepare = prepareCoachTrade as unknown as (input: unknown) => Promise<unknown>;
describe("coach confirmation executes once with account protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.facts.mockResolvedValue({ account: { ...account, accountType: "demo", currency: "USD" }, live: false, equity: 50000, riskPct: 0.5, sizeFromRisk: () => 25 });
    mocks.risk.mockResolvedValue(1);
    mocks.claim.mockResolvedValueOnce({ data: { id: proposalId }, error: null }).mockResolvedValue({ data: null, error: null });
    mocks.session.mockResolvedValue({ accountId: "demo1", env: "demo" });
    mocks.quote.mockResolvedValue({ ask: 4000, bid: 3999 });
    mocks.place.mockResolvedValue({ orderId: "order1", fillPrice: 4000 });
    mocks.insert.mockResolvedValue({ error: null });
  });
  it("review preparation saves only a blocked record and never sends an order", async () => {
    await prepare({ data: plan, context: { userId, supabase: db() } });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "blocked", user_id: userId }));
    expect(mocks.place).not.toHaveBeenCalled();
  });
  it("only one of two confirmations reaches the broker and it carries both protections", async () => {
    const input = { data: { token: token(), confirmed: true, acknowledgeLive: false }, context: { userId, supabase: db() } };
    expect(await confirm(input)).toEqual(expect.objectContaining({ orderId: "order1" }));
    await expect(confirm(input)).rejects.toThrow("already been used");
    expect(mocks.place).toHaveBeenCalledTimes(1);
    expect(mocks.place).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stopLoss: 3990, takeProfit: 4020, size: 25 }));
    expect(mocks.journal).toHaveBeenCalledWith(expect.objectContaining({ userId, proposalId, entry: 4000 }));
  });
  it("another user cannot confirm the review", async () => {
    await expect(confirm({ data: { token: token(), confirmed: true, acknowledgeLive: false }, context: { userId: proposalId, supabase: db() } })).rejects.toThrow("another account");
    expect(mocks.place).not.toHaveBeenCalled();
  });
  it("account changes after review prevent execution", async () => {
    mocks.session.mockResolvedValue({ accountId: "live2", env: "live" });
    await expect(confirm({ data: { token: token(), confirmed: true, acknowledgeLive: false }, context: { userId, supabase: db() } })).rejects.toThrow("account changed");
    expect(mocks.place).not.toHaveBeenCalled();
  });
  it("price running more than 0.25R away cannot become a chase order", async () => {
    mocks.quote.mockResolvedValue({ ask: 4003, bid: 4002 });
    await expect(confirm({ data: { token: token(), confirmed: true, acknowledgeLive: false }, context: { userId, supabase: db() } })).rejects.toThrow("Price moved");
    expect(mocks.place).not.toHaveBeenCalled();
  });
  it("ambiguous broker failures are not automatically retried", async () => {
    mocks.place.mockRejectedValue(new Error("Connection interrupted"));
    const input = { data: { token: token(), confirmed: true, acknowledgeLive: false }, context: { userId, supabase: db() } };
    await expect(confirm(input)).rejects.toThrow("will not be retried");
    await expect(confirm(input)).rejects.toThrow("already been used");
    expect(mocks.place).toHaveBeenCalledTimes(1);
    expect(mocks.journal).not.toHaveBeenCalled();
  });
});