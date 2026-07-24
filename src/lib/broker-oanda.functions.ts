// OANDA v20 broker integration.
// Uses OANDA_API_KEY + OANDA_ACCOUNT_ID from server env. Set OANDA_ENV=practice
// to route to the sandbox; anything else (or unset) hits live.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const OANDA_MAP: Record<string, string> = {
  "EUR/USD": "EUR_USD", "GBP/USD": "GBP_USD", "USD/JPY": "USD_JPY",
  "USD/CHF": "USD_CHF", "AUD/USD": "AUD_USD", "NZD/USD": "NZD_USD",
  "USD/CAD": "USD_CAD", "XAU/USD": "XAU_USD", "XAG/USD": "XAG_USD",
  "NAS100": "NAS100_USD", "SPX500": "SPX500_USD", "US30": "US30_USD",
  "WTI OIL": "WTICO_USD",
};

function toOandaInstrument(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (OANDA_MAP[s]) return OANDA_MAP[s];
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(s)) return s;
  return null;
}

function oandaHost(): { host: string; env: "practice" | "live" } {
  const env = (process.env.OANDA_ENV ?? "live").toLowerCase();
  return env === "practice"
    ? { host: "api-fxpractice.oanda.com", env: "practice" }
    : { host: "api-fxtrade.oanda.com", env: "live" };
}

function oandaConfig() {
  const apiKey = process.env.OANDA_API_KEY;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!apiKey || !accountId) throw new Error("OANDA credentials not configured");
  const { host, env } = oandaHost();
  return { apiKey, accountId, host, env };
}

async function oandaFetch(path: string, init: RequestInit = {}) {
  const { apiKey, accountId, host } = oandaConfig();
  const res = await fetch(`https://${host}/v3/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw text */ }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "errorMessage" in (body as Record<string, unknown>)
      ? String((body as Record<string, unknown>).errorMessage)
      : `OANDA request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as Record<string, unknown>;
}

export const getBrokerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    if (!process.env.OANDA_API_KEY || !process.env.OANDA_ACCOUNT_ID) {
      return { connected: false as const, reason: "Missing OANDA credentials" };
    }
    try {
      const { env } = oandaHost();
      const account = await oandaFetch("/summary");
      const a = (account.account ?? {}) as Record<string, string>;
      return {
        connected: true as const,
        env,
        accountId: a.id ?? null,
        currency: a.currency ?? null,
        balance: a.balance ? Number(a.balance) : null,
        nav: a.NAV ? Number(a.NAV) : null,
        unrealizedPL: a.unrealizedPL ? Number(a.unrealizedPL) : null,
        openTradeCount: a.openTradeCount ? Number(a.openTradeCount) : 0,
        marginAvailable: a.marginAvailable ? Number(a.marginAvailable) : null,
      };
    } catch (e) {
      return { connected: false as const, reason: (e as Error).message };
    }
  });

export const listBrokerPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const data = await oandaFetch("/openTrades");
    const trades = (data.trades ?? []) as Array<Record<string, unknown>>;
    return trades.map((t) => ({
      id: String(t.id ?? ""),
      instrument: String(t.instrument ?? ""),
      currentUnits: Number(t.currentUnits ?? 0),
      price: Number(t.price ?? 0),
      unrealizedPL: Number(t.unrealizedPL ?? 0),
      openTime: String(t.openTime ?? ""),
    }));
  });

const PlaceOrderInput = z.object({
  symbol: z.string().min(1),
  side: z.enum(["long", "short"]),
  units: z.number().positive().max(1_000_000),
  orderType: z.enum(["market", "limit", "stop"]).default("market"),
  price: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
});

export const placeBrokerOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => PlaceOrderInput.parse(raw))
  .handler(async ({ data }) => {
    const instrument = toOandaInstrument(data.symbol);
    if (!instrument) throw new Error(`Symbol ${data.symbol} is not supported by OANDA`);

    const signedUnits = (data.side === "long" ? 1 : -1) * Math.floor(data.units);
    const type = data.orderType === "market" ? "MARKET"
      : data.orderType === "limit" ? "LIMIT" : "STOP";

    const order: Record<string, unknown> = {
      type,
      instrument,
      units: String(signedUnits),
      timeInForce: type === "MARKET" ? "FOK" : "GTC",
      positionFill: "DEFAULT",
    };
    if (type !== "MARKET") {
      if (!data.price) throw new Error("price is required for limit/stop orders");
      order.price = data.price.toString();
    }
    if (data.stopLoss) order.stopLossOnFill = { price: data.stopLoss.toString(), timeInForce: "GTC" };
    if (data.takeProfit) order.takeProfitOnFill = { price: data.takeProfit.toString(), timeInForce: "GTC" };

    const resp = await oandaFetch("/orders", {
      method: "POST",
      body: JSON.stringify({ order }),
    });
    const fill = (resp.orderFillTransaction ?? resp.orderCreateTransaction ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      orderId: fill.id ? String(fill.id) : null,
      instrument,
      units: signedUnits,
      fillPrice: fill.price ? Number(fill.price) : null,
      raw: resp,
    };
  });

export const closeBrokerTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ tradeId: z.string().min(1) }).parse(raw))
  .handler(async ({ data }) => {
    const resp = await oandaFetch(`/trades/${encodeURIComponent(data.tradeId)}/close`, {
      method: "PUT",
      body: JSON.stringify({ units: "ALL" }),
    });
    return { ok: true, raw: resp };
  });
