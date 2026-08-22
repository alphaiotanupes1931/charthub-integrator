import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "@/lib/capability-middleware";

// Alpaca supports real OAuth, so this is a genuine one-click "Sign in with Alpaca"
// flow: the trader logs in on Alpaca's own site and we never see their password.

/** Step 1: build the Alpaca consent URL for this signed-in user. */
export const startAlpacaLogin = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => z.object({ origin: z.string().url() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { authorizeUrl } = await import("@/lib/broker-alpaca.server");
    return { url: authorizeUrl(data.origin, context.userId) };
  });

/** Step 2: exchange the callback code for a token and save it encrypted. */
export const completeAlpacaLogin = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        code: z.string().min(1),
        state: z.string().min(1),
        origin: z.string().url(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { verifyState, exchangeCode, detectAccount, saveSession } = await import(
      "@/lib/broker-alpaca.server"
    );
    if (!verifyState(data.state, context.userId)) {
      throw new Error("This Alpaca login link expired. Start the login again.");
    }
    const token = await exchangeCode(data.code, data.origin);
    const { env, account } = await detectAccount(token);
    await saveSession(context.userId, token, env, account.id);
    return {
      ok: true as const,
      env,
      accountNumber: account.account_number ?? null,
    };
  });

/** Live view of the connected Alpaca account. */
export const getAlpacaStatus = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const { loadSession, alpacaFetch } = await import("@/lib/broker-alpaca.server");
    try {
      const session = await loadSession(context.userId);
      const account = await alpacaFetch<Record<string, string | boolean>>(
        session.token,
        session.env,
        "/v2/account",
      );
      return {
        connected: true as const,
        env: session.env,
        accountId: String(account.id ?? session.accountId ?? ""),
        accountNumber: account.account_number ? String(account.account_number) : null,
        status: account.status ? String(account.status) : null,
        currency: account.currency ? String(account.currency) : "USD",
        equity: account.equity ? Number(account.equity) : null,
        cash: account.cash ? Number(account.cash) : null,
        buyingPower: account.buying_power ? Number(account.buying_power) : null,
        tradingBlocked: Boolean(account.trading_blocked),
      };
    } catch (e) {
      return { connected: false as const, reason: (e as Error).message };
    }
  });

/** Open positions on the connected Alpaca account. */
export const getAlpacaPositions = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const { loadSession, alpacaFetch } = await import("@/lib/broker-alpaca.server");
    const session = await loadSession(context.userId);
    const rows = await alpacaFetch<Array<Record<string, string>>>(
      session.token,
      session.env,
      "/v2/positions",
    );
    return (rows ?? []).map((p) => ({
      symbol: String(p.symbol),
      side: String(p.side),
      qty: Number(p.qty),
      avgPrice: Number(p.avg_entry_price),
      marketValue: Number(p.market_value),
      unrealizedPl: Number(p.unrealized_pl),
    }));
  });

/** Place an order on the connected Alpaca account. */
export const placeAlpacaOrder = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        symbol: z.string().trim().min(1).max(20),
        side: z.enum(["buy", "sell"]),
        qty: z.number().positive(),
        type: z.enum(["market", "limit", "stop"]).default("market"),
        limitPrice: z.number().positive().optional(),
        stopPrice: z.number().positive().optional(),
        takeProfit: z.number().positive().optional(),
        stopLoss: z.number().positive().optional(),
        timeInForce: z.enum(["day", "gtc"]).default("day"),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { loadSession, alpacaFetch } = await import("@/lib/broker-alpaca.server");
    const session = await loadSession(context.userId);
    const body: Record<string, unknown> = {
      symbol: data.symbol.toUpperCase(),
      side: data.side,
      qty: String(data.qty),
      type: data.type,
      time_in_force: data.timeInForce,
    };
    if (data.type === "limit") body.limit_price = String(data.limitPrice ?? "");
    if (data.type === "stop") body.stop_price = String(data.stopPrice ?? "");
    if (data.takeProfit || data.stopLoss) {
      body.order_class = "bracket";
      if (data.takeProfit) body.take_profit = { limit_price: String(data.takeProfit) };
      if (data.stopLoss) body.stop_loss = { stop_price: String(data.stopLoss) };
    }
    const order = await alpacaFetch<Record<string, string>>(session.token, session.env, "/v2/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { ok: true as const, orderId: String(order.id), status: String(order.status) };
  });

/** Close a single open position at market. */
export const closeAlpacaPosition = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => z.object({ symbol: z.string().trim().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { loadSession, alpacaFetch } = await import("@/lib/broker-alpaca.server");
    const session = await loadSession(context.userId);
    await alpacaFetch(session.token, session.env, `/v2/positions/${encodeURIComponent(data.symbol)}`, {
      method: "DELETE",
    });
    return { ok: true as const };
  });

/** Disconnect the Alpaca login. */
export const disconnectAlpaca = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .delete()
      .eq("user_id", context.userId)
      .eq("broker", "alpaca");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
