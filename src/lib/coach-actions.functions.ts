import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "./capability-middleware";
import { coachPlanSchema, assertCoachAccount, assertCoachConfirmation } from "./coach-actions.shared";

const ticketSchema = z.object({
  userId: z.string().uuid(), proposalId: z.string().uuid(), expiresAt: z.string(),
  account: z.object({ broker: z.enum(["oanda", "tradelocker"]), accountId: z.string(), env: z.string() }),
  plan: coachPlanSchema, units: z.number().positive(), riskPct: z.number().positive(),
});

export const prepareCoachTrade = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => coachPlanSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { coachAccountFacts } = await import("./coach-actions.server");
    const facts = await coachAccountFacts(context.userId, context.supabase, data.symbol, data.grade);
    const { savedDrawRisk } = await import("./draw-order-risk.server");
    const riskPct = facts.riskPct * await savedDrawRisk(context.supabase, context.userId, data.symbol, data.entry, data.stop);
    const units = facts.sizeFromRisk(facts.equity, riskPct, data.entry, data.stop);
    if (!units) throw new Error("This stop distance cannot be sized within your risk limit.");
    const proposalId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const account = { broker: facts.account.broker, env: facts.account.env, accountId: facts.account.accountId ?? "" };
    const { encryptSecret } = await import("./broker-crypto.server");
    const token = encryptSecret(JSON.stringify({ userId: context.userId, proposalId, expiresAt, account, plan: data, units, riskPct }));
    // Blocked proposals cannot be picked up by the scheduled runner. Only this
    // ticket's one-time confirmation can claim the row.
    const { error } = await context.supabase.from("autopilot_proposals").insert({
      id: proposalId, user_id: context.userId, symbol: data.symbol, side: data.side,
      grade: data.grade, entry: data.entry, stop_loss: data.stop, take_profit: data.target,
      timeframe: data.timeframe ?? null, units, risk_pct: riskPct, status: "blocked",
      rejection_reason: "Awaiting explicit coach trade confirmation", expires_at: expiresAt,
      account_target: facts.live ? "live" : "paper", reasoning: "Coach trade review; no order sent",
    });
    if (error) throw new Error("The trade review could not be saved.");
    return { token, account, live: facts.live, accountType: facts.account.accountType ?? facts.account.env,
      plan: data, units, riskPct, riskAmount: units * Math.abs(data.entry - data.stop),
      currency: facts.account.currency, expiresAt };
  });

export const confirmCoachTrade = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => z.object({ token: z.string().max(12000), confirmed: z.literal(true), acknowledgeLive: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { decryptSecret } = await import("./broker-crypto.server");
    const ticket = ticketSchema.parse(JSON.parse(decryptSecret(data.token)));
    if (ticket.userId !== context.userId) throw new Error("This trade review belongs to another account.");
    const { coachAccountFacts } = await import("./coach-actions.server");
    const facts = await coachAccountFacts(context.userId, context.supabase, ticket.plan.symbol, ticket.plan.grade);
    assertCoachAccount(ticket.account, facts.account);
    assertCoachConfirmation(ticket.expiresAt, data.confirmed, facts.live, data.acknowledgeLive);
    const { savedDrawRisk } = await import("./draw-order-risk.server");
    const currentRiskPct = facts.riskPct * await savedDrawRisk(context.supabase, context.userId, ticket.plan.symbol, ticket.plan.entry, ticket.plan.stop);
    const maxUnits = facts.sizeFromRisk(facts.equity, currentRiskPct, ticket.plan.entry, ticket.plan.stop);
    if (!maxUnits || ticket.units > maxUnits) throw new Error("Your risk allowance changed. Review this trade again.");
    // Claim before contacting the broker. Ambiguous broker failures are never retried.
    const { data: claim, error } = await context.supabase.from("autopilot_proposals")
      .update({ status: "approved", rejection_reason: null, decided_at: new Date().toISOString() })
      .eq("id", ticket.proposalId).eq("user_id", context.userId).eq("status", "blocked")
      .gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (error || !claim) throw new Error("This review has already been used or expired. Check your account before trying again.");
    try {
      const p = ticket.plan;
      let orderId: string;
      let fill: number;
      if (ticket.account.broker === "tradelocker") {
        const { tradeLockerSession, tradeLockerInstrument, tradeLockerQuote, tradeLockerPlaceOrder } = await import("./venues/tradelocker.server");
        const session = await tradeLockerSession(context.userId);
        assertCoachAccount(ticket.account, { broker: "tradelocker", accountId: session.accountId, env: session.env });
        const quote = await tradeLockerQuote(session, await tradeLockerInstrument(session, p.symbol));
        const price = p.side === "long" ? quote.ask : quote.bid;
        if (!price || Math.abs(price - p.entry) > Math.abs(p.entry - p.stop) * 0.25) throw new Error("Price moved away from the planned entry. No order sent; request a fresh review.");
        coachPlanSchema.parse({ ...p, entry: price });
        const result = await tradeLockerPlaceOrder(session, { symbol: p.symbol, side: p.side, size: ticket.units, stopLoss: p.stop, takeProfit: p.target });
        orderId = result.orderId; fill = result.fillPrice ?? price;
      } else {
        const { oandaEstimate, oandaStatus } = await import("./broker-oanda.functions");
        const status = await oandaStatus(context.userId);
        if (!status.connected) throw new Error("Your OANDA account could not be checked.");
        assertCoachAccount(ticket.account, { broker: "oanda", accountId: status.accountId, env: String(status.env) });
        const quote = await oandaEstimate(context.userId, { symbol: p.symbol, units: ticket.units });
        const price = p.side === "long" ? quote.ask : quote.bid;
        if (!price || Math.abs(price - p.entry) > Math.abs(p.entry - p.stop) * 0.25) throw new Error("Price moved away from the planned entry. No order sent; request a fresh review.");
        coachPlanSchema.parse({ ...p, entry: price });
        const { loadOandaCreds, oandaHost } = await import("./broker-readonly.server");
        const { oandaInstrument } = await import("./autopilot-live.server");
        const creds = await loadOandaCreds(context.userId);
        if (!creds) throw new Error("Your linked OANDA credentials are unavailable.");
        // Send to the exact confirmed account/host, without fallback account selection.
        const response = await fetch(`https://${oandaHost(ticket.account.env === "live" ? "live" : "practice")}/v3/accounts/${encodeURIComponent(ticket.account.accountId)}/orders`, {
          method: "POST", headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ order: { type: "MARKET", instrument: oandaInstrument(p.symbol), units: String(p.side === "long" ? ticket.units : -ticket.units),
            timeInForce: "FOK", positionFill: "DEFAULT", priceBound: String(p.side === "long" ? p.entry + Math.abs(p.entry - p.stop) * 0.25 : p.entry - Math.abs(p.entry - p.stop) * 0.25),
            stopLossOnFill: { price: String(p.stop), timeInForce: "GTC" }, takeProfitOnFill: { price: String(p.target), timeInForce: "GTC" } } }),
        });
        const result = await response.json() as { orderFillTransaction?: { id?: string; price?: string } };
        if (!response.ok || !result.orderFillTransaction?.id) throw new Error("OANDA did not confirm a fill. Check your account for the order outcome.");
        orderId = result.orderFillTransaction.id; fill = Number(result.orderFillTransaction.price ?? price);
      }
      await context.supabase.from("autopilot_proposals").update({ status: "filled", broker_order_id: orderId }).eq("id", ticket.proposalId).eq("user_id", context.userId);
      const { journalPlacedTrade } = await import("./journal-auto.server");
      await journalPlacedTrade({ userId: context.userId, proposalId: ticket.proposalId, symbol: p.symbol, side: p.side,
        timeframe: p.timeframe, entry: fill, stopLoss: p.stop, takeProfit: p.target, units: ticket.units,
        grade: p.grade, detail: `Confirmed in coach chat on ${ticket.account.broker} account ${ticket.account.accountId}. Order ${orderId}.` });
      return { orderId, detail: `Order ${orderId} accepted on ${ticket.account.broker} account ${ticket.account.accountId}.` };
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Order outcome unavailable; check your broker before trying again.";
      await context.supabase.from("autopilot_proposals").update({ status: "failed", rejection_reason: detail }).eq("id", ticket.proposalId).eq("user_id", context.userId);
      throw new Error(`${detail} This confirmation will not be retried. Check your broker before submitting another order.`);
    }
  });