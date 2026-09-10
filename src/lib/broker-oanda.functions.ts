// OANDA v20 broker integration. Loads each user's encrypted credentials from
// public.user_broker_credentials; falls back to project-level OANDA_API_KEY/
// OANDA_ACCOUNT_ID env vars when a user has not saved their own.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "@/lib/capability-middleware";

type OandaEnv = "practice" | "live";
type OandaEndpoint = { host: string; env: OandaEnv };
type OandaConfig = { apiKey: string; accountId?: string; preferredEnv: OandaEnv; source: "user" | "env" };
type OandaAccount = { id?: string; tags?: string[] };

const OANDA_MAP: Record<string, string> = {
  "EUR/USD": "EUR_USD", "GBP/USD": "GBP_USD", "USD/JPY": "USD_JPY",
  "USD/CHF": "USD_CHF", "AUD/USD": "AUD_USD", "NZD/USD": "NZD_USD",
  "USD/CAD": "USD_CAD", "XAU/USD": "XAU_USD", "XAG/USD": "XAG_USD",
  "NAS100": "NAS100_USD", "SPX500": "SPX500_USD", "US30": "US30_USD",
  "WTI OIL": "WTICO_USD",
  // Display / TradingView aliases that arrive without separators
  NAS100USD: "NAS100_USD", US100: "NAS100_USD", USTEC: "NAS100_USD", NDX: "NAS100_USD",
  SPX500USD: "SPX500_USD", US500: "SPX500_USD", SPX: "SPX500_USD", SPY500: "SPX500_USD",
  US30USD: "US30_USD", DJI: "US30_USD", DOW: "US30_USD", US30CASH: "US30_USD",
  DE30: "DE30_EUR", DE40: "DE30_EUR", GER40: "DE30_EUR",
  UK100: "UK100_GBP", JP225: "JP225_USD",
  USOIL: "WTICO_USD", WTIUSD: "WTICO_USD", WTICOUSD: "WTICO_USD", CL1: "WTICO_USD",
  UKOIL: "BCO_USD", BRENT: "BCO_USD",
  XAUUSD: "XAU_USD", GOLD: "XAU_USD", XAGUSD: "XAG_USD", SILVER: "XAG_USD",
};

const FX_CODES = /^(AUD|CAD|CHF|CNH|CZK|DKK|EUR|GBP|HKD|HUF|JPY|MXN|NOK|NZD|PLN|SEK|SGD|THB|TRY|USD|ZAR|XAU|XAG|XPD|XPT)$/;

function toOandaInstrument(symbol: string): string | null {
  const raw = symbol.trim().toUpperCase();
  // "Gold (XAU/USD)" -> "XAU/USD"
  const inner = raw.match(/\(([^)]+)\)/)?.[1]?.trim();
  const candidates = [raw, inner ?? ""].filter(Boolean);
  for (const c of candidates) {
    if (OANDA_MAP[c]) return OANDA_MAP[c];
    const stripped = c.replace(/^OANDA:/, "").replace(/[^A-Z0-9]/g, "");
    if (OANDA_MAP[stripped]) return OANDA_MAP[stripped];
    if (/^[A-Z]{3}_[A-Z]{3}$/.test(c)) return c;
    if (stripped.length === 6) {
      const base = stripped.slice(0, 3);
      const quote = stripped.slice(3);
      if (FX_CODES.test(base) && FX_CODES.test(quote)) return `${base}_${quote}`;
    }
  }
  return null;
}


function hostFor(env: OandaEnv): OandaEndpoint {
  return env === "live"
    ? { host: "api-fxtrade.oanda.com", env: "live" }
    : { host: "api-fxpractice.oanda.com", env: "practice" };
}

// Always try the saved environment first, then the other one. OANDA issues
// separate tokens on fxTrade (live) and fxTrade Practice (demo); a token pasted
// into the wrong slot returns "Insufficient authorization" on that host only, so
// checking both lets us connect anyway and tell the user which one it belongs to.
function endpointsFor(preferred: OandaEnv, _pinned = false): OandaEndpoint[] {
  const other: OandaEnv = preferred === "live" ? "practice" : "live";
  return [hostFor(preferred), hostFor(other)];
}


async function loadUserOandaConfig(userId: string): Promise<OandaConfig | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_broker_credentials")
    .select("api_key_ciphertext, account_id, env, is_active, updated_at")
    .eq("user_id", userId)
    .eq("broker", "oanda")
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false });
  const row = (data ?? [])[0];
  if (!row) return null;
  const { decryptSecret } = await import("@/lib/broker-crypto.server");
  return {
    apiKey: decryptSecret(row.api_key_ciphertext),
    accountId: row.account_id?.trim() || undefined,
    preferredEnv: (row.env as OandaEnv) ?? "practice",
    source: "user",
  };
}


function envOandaConfig(): OandaConfig | null {
  const apiKey = process.env.OANDA_API_KEY;
  if (!apiKey) return null;
  const accountId = process.env.OANDA_ACCOUNT_ID?.trim() || undefined;
  const envName = (process.env.OANDA_ENV ?? "practice").toLowerCase();
  return {
    apiKey,
    accountId,
    preferredEnv: envName === "live" ? "live" : "practice",
    source: "env",
  };
}

async function loadOandaConfig(userId: string): Promise<OandaConfig> {
  const user = await loadUserOandaConfig(userId);
  if (user) return user;
  const env = envOandaConfig();
  if (env) return env;
  throw new Error("No OANDA credentials on file. Add your API key and Account ID on the Broker page.");
}

async function parseOandaResponse(res: Response) {
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw text */ }
  return body;
}

function oandaErrorMessage(body: unknown, status: number): string {
  if (typeof body === "object" && body) {
    const b = body as Record<string, unknown>;
    if (typeof b.errorMessage === "string") return b.errorMessage;
    if (typeof b.errorCode === "string") return b.errorCode;
  }
  return `OANDA request failed (${status})`;
}

async function tryOandaFetch(endpoint: OandaEndpoint, accountId: string, apiKey: string, path: string, init: RequestInit) {
  const res = await fetch(`https://${endpoint.host}/v3/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await parseOandaResponse(res);
  return { res, body };
}

async function listOandaAccounts(endpoint: OandaEndpoint, apiKey: string) {
  const res = await fetch(`https://${endpoint.host}/v3/accounts`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const body = await parseOandaResponse(res);
  if (!res.ok) return { ok: false as const, status: res.status, body, accounts: [] as OandaAccount[] };
  const accounts = typeof body === "object" && body && Array.isArray((body as Record<string, unknown>).accounts)
    ? ((body as Record<string, unknown>).accounts as OandaAccount[])
    : [];
  return { ok: true as const, status: res.status, body, accounts };
}

async function resolveOandaAccount(userId: string): Promise<{ apiKey: string; accountId: string; configuredAccountId?: string; discovered: boolean; source: "user" | "env" } & OandaEndpoint> {
  const cfg = await loadOandaConfig(userId);
  const endpoints = endpointsFor(cfg.preferredEnv, cfg.source === "user");
  const failedMessages: string[] = [];
  const note = (m: string) => { if (!failedMessages.includes(m)) failedMessages.push(m); };

  if (cfg.accountId) {
    for (const endpoint of endpoints) {
      const summary = await tryOandaFetch(endpoint, cfg.accountId, cfg.apiKey, "/summary", { method: "GET" });
      if (summary.res.ok) {
        return { apiKey: cfg.apiKey, accountId: cfg.accountId, configuredAccountId: cfg.accountId, source: cfg.source, ...endpoint, discovered: false };
      }
      note(`${endpoint.env}: ${oandaErrorMessage(summary.body, summary.res.status)}`);
    }
  }

  for (const endpoint of endpoints) {
    const listed = await listOandaAccounts(endpoint, cfg.apiKey);
    if (!listed.ok) {
      note(`${endpoint.env}: ${oandaErrorMessage(listed.body, listed.status)}`);
      continue;
    }
    const discoveredId = listed.accounts.find((a) => typeof a.id === "string" && a.id.trim().length > 0)?.id;
    if (discoveredId) {
      return { apiKey: cfg.apiKey, accountId: discoveredId, configuredAccountId: cfg.accountId, source: cfg.source, ...endpoint, discovered: true };
    }
    note(`${endpoint.env}: this API key has no accounts`);
  }

  const suffix = failedMessages.length > 0 ? ` Details - ${failedMessages.join("; ")}.` : "";
  throw new Error(
    `OANDA rejected this API key on both the demo and live servers.${suffix} Generate a fresh personal access token from the account you want to trade: demo tokens come from the fxTrade Practice site (Manage API Access), live tokens from fxTrade. Paste the token into the matching slot here, and leave Account ID blank to auto-detect.`,
  );
}


async function oandaFetch(userId: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown> & { __env?: OandaEnv; __accountId?: string; __discovered?: boolean; __configuredAccountId?: string }> {
  const config = await resolveOandaAccount(userId);
  const attempt = await tryOandaFetch(config, config.accountId, config.apiKey, path, init);
  if (!attempt.res.ok) {
    throw new Error(oandaErrorMessage(attempt.body, attempt.res.status));
  }
  const body = (typeof attempt.body === "object" && attempt.body ? attempt.body : {}) as Record<string, unknown>;
  return Object.assign(body, {
    __env: config.env,
    __accountId: config.accountId,
    __discovered: config.discovered,
    __configuredAccountId: config.configuredAccountId,
  });
}

/** Plain server helper so other venues can share one status shape. */
export async function oandaStatus(userId: string) {
  try {
    const account = await oandaFetch(userId, "/summary");
    const a = (account.account ?? {}) as Record<string, string>;
    return {
      connected: true as const,
      env: account.__env ?? "practice",
      accountId: a.id ?? null,
      configuredAccountId: account.__configuredAccountId ?? null,
      usingDiscoveredAccount: account.__discovered ?? false,
      currency: a.currency ?? null,
      balance: a.balance ? Number(a.balance) : null,
      nav: a.NAV ? Number(a.NAV) : null,
      unrealizedPL: a.unrealizedPL ? Number(a.unrealizedPL) : null,
      openTradeCount: a.openTradeCount ? Number(a.openTradeCount) : 0,
      marginAvailable: a.marginAvailable ? Number(a.marginAvailable) : null,
      // Where the trader adds money to this exact account.
      fundingUrl:
        (account.__env ?? "practice") === "live"
          ? "https://www.oanda.com/account/funding"
          : "https://trade.practice.oanda.com/",
    };
  } catch (e) {
    return { connected: false as const, reason: (e as Error).message };
  }
}

export const getBrokerStatus = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => oandaStatus(context.userId));


// Identity check: OANDA has no OAuth login for retail traders, so "being logged
// in" here means the saved token resolves to a real OANDA account. This lists
// every account the token is authorized for, with the alias OANDA shows in its
// own platform, so the trader can confirm it is really their account.
export const verifyOandaIdentity = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    try {
      const cfg = await loadOandaConfig(context.userId);
      for (const endpoint of endpointsFor(cfg.preferredEnv)) {
        const listed = await listOandaAccounts(endpoint, cfg.apiKey);
        if (!listed.ok || listed.accounts.length === 0) continue;
        const accounts = [];
        for (const a of listed.accounts) {
          if (!a.id) continue;
          const s = await tryOandaFetch(endpoint, a.id, cfg.apiKey, "/summary", { method: "GET" });
          const acc = ((s.body as Record<string, unknown>)?.account ?? {}) as Record<string, string>;
          accounts.push({
            id: a.id,
            alias: acc.alias ?? null,
            currency: acc.currency ?? null,
            balance: acc.balance ? Number(acc.balance) : null,
            openTradeCount: acc.openTradeCount ? Number(acc.openTradeCount) : 0,
            active: a.id === cfg.accountId,
          });
        }
        return {
          verified: true as const,
          env: endpoint.env,
          tokenSource: cfg.source,
          accounts,
        };
      }
      return { verified: false as const, reason: "This token is not authorized on either OANDA server." };
    } catch (e) {
      return { verified: false as const, reason: (e as Error).message };
    }
  });


// Estimate how much margin this account needs to open a position.
// Returns the current mid price and the approximate margin required.
const EstimateMarginInput = z.object({
  symbol: z.string().min(1),
  units: z.number().positive().max(1_000_000),
});

export async function oandaEstimate(userId: string, data: { symbol: string; units: number }) {
  {
    const instrument = toOandaInstrument(data.symbol);
    if (!instrument) throw new Error(`Symbol ${data.symbol} is not supported by OANDA`);

    const config = await resolveOandaAccount(userId);

    const pricing = await tryOandaFetch(
      config,
      config.accountId,
      config.apiKey,
      `/pricing?instruments=${encodeURIComponent(instrument)}`,
      { method: "GET" },
    );
    if (!pricing.res.ok) {
      return {
        instrument,
        price: null,
        bid: null,
        ask: null,
        marginRate: null,
        notional: null,
        required: null,
        currency: "USD",
        unavailable: oandaErrorMessage(pricing.body, pricing.res.status),
      };
    }
    const priceObj = (pricing.body as {
      prices?: Array<{
        bids?: Array<{ price: string }>;
        asks?: Array<{ price: string }>;
        quoteHomeConversionFactors?: { positiveUnits?: string; negativeUnits?: string };
      }>;
    }).prices?.[0];
    const bid = priceObj?.bids?.[0]?.price ? Number(priceObj.bids[0].price) : null;
    const ask = priceObj?.asks?.[0]?.price ? Number(priceObj.asks[0].price) : null;
    const mid = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? null;
    if (mid == null || !Number.isFinite(mid)) {
      return {
        instrument,
        price: null,
        bid,
        ask,
        marginRate: null,
        notional: null,
        required: null,
        currency: "USD",
        unavailable: "No live price is available for this market right now.",
      };
    }

    const details = await tryOandaFetch(
      config,
      config.accountId,
      config.apiKey,
      `/instruments?instruments=${encodeURIComponent(instrument)}`,
      { method: "GET" },
    );
    const detailsOk = details.res.ok;
    const detailsNote = detailsOk ? null : oandaErrorMessage(details.body, details.res.status);
    const marginRate = Number(
      (details.body as { instruments?: Array<{ marginRate?: string }> }).instruments?.[0]?.marginRate ?? "",
    );
    const rate = detailsOk && Number.isFinite(marginRate) && marginRate > 0 ? marginRate : null;

    const notional = data.units * mid;
    const conversion = Number(
      priceObj?.quoteHomeConversionFactors?.positiveUnits
      ?? priceObj?.quoteHomeConversionFactors?.negativeUnits
      ?? "1",
    );
    const homeConversion = Number.isFinite(conversion) && conversion > 0 ? conversion : 1;
    const required = rate != null ? notional * homeConversion * rate : null;
    return {
      instrument,
      price: mid,
      bid,
      ask,
      marginRate: rate,
      notional,
      required,
      currency: "USD",
      unavailable: rate == null
        ? (detailsNote ?? "Margin details are not available for this market right now.")
        : null,
    };
  }
}

export const estimateBrokerMargin = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => EstimateMarginInput.parse(raw))
  .handler(async ({ data, context }) => oandaEstimate(context.userId, data));


export const listBrokerPositions = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const data = await oandaFetch(context.userId, "/openTrades");
    const trades = (data.trades ?? []) as Array<Record<string, unknown>>;
    return trades.map((t) => ({
      id: String(t.id ?? ""),
      instrument: String(t.instrument ?? ""),
      currentUnits: Number(t.currentUnits ?? 0),
      price: Number(t.price ?? 0),
      unrealizedPL: Number(t.unrealizedPL ?? 0),
      openTime: String(t.openTime ?? ""),
      stopLoss: (t.stopLossOrder as { price?: string } | undefined)?.price
        ? Number((t.stopLossOrder as { price: string }).price) : null,
      takeProfit: (t.takeProfitOrder as { price?: string } | undefined)?.price
        ? Number((t.takeProfitOrder as { price: string }).price) : null,
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

export type PlaceOrderData = z.infer<typeof PlaceOrderInput>;

export async function oandaPlaceOrder(userId: string, data: PlaceOrderData) {
  {
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

    const resp = await oandaFetch(userId, "/orders", {
      method: "POST",
      body: JSON.stringify({ order }),
    }).catch((e: Error) => {
      if (/not tradeable/i.test(e.message)) {
        throw new Error(
          `Your account cannot trade ${data.symbol} (${instrument}). Pick an instrument your account supports, or check that this market is open.`,
        );
      }
      if (/insufficient.?margin|insufficient.?funds|insufficient.?liquidity/i.test(e.message)) {
        throw new Error(
          `Not enough money in your account to open ${Math.abs(signedUnits)} units of ${data.symbol}. Lower the units, or add funds to your account, then try again.`,
        );
      }
      throw e;
    });

    const cancel = resp.orderCancelTransaction as Record<string, unknown> | undefined;
    const reject = resp.orderRejectTransaction as Record<string, unknown> | undefined;
    if (cancel || reject) {
      const reason = String(cancel?.reason ?? reject?.reason ?? "Order was not filled");
      if (/INSUFFICIENT_MARGIN|INSUFFICIENT_FUNDS|INSUFFICIENT_LIQUIDITY/i.test(reason)) {
        throw new Error(
          `Not enough money in your account to open ${Math.abs(signedUnits)} units of ${data.symbol}. Lower the units, or add funds to your account, then try again.`,
        );
      }
      throw new Error(`Your broker did not accept the order: ${reason}.`);
    }
    const fill = resp.orderFillTransaction as Record<string, unknown> | undefined;
    const created = resp.orderCreateTransaction as Record<string, unknown> | undefined;
    if (type === "MARKET") {
      if (!fill || !fill.id) {
        throw new Error("Order was not filled by your broker. Check your available balance, then try again.");
      }
    } else if (!created?.id) {
      throw new Error("Your broker did not create the working order. Check the price and try again.");
    }
    const env = resp.__env === "live" ? "live" : "practice";
    return {
      ok: true,
      orderId: String(fill?.id ?? created?.id ?? ""),
      pending: type !== "MARKET",
      instrument,
      units: signedUnits,
      fillPrice: fill?.price ? Number(fill.price) : null,
      accountId: String(resp.__accountId ?? ""),
      brokerUrl:
        env === "live"
          ? "https://trade.oanda.com/"
          : "https://trade.practice.oanda.com/",
    };
  });

export const closeBrokerTrade = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => z.object({ tradeId: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    await oandaFetch(context.userId, `/trades/${encodeURIComponent(data.tradeId)}/close`, {
      method: "PUT",
      body: JSON.stringify({ units: "ALL" }),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Trade adjustments: change stop-loss / take-profit on a live OANDA trade,
// close part of a position, and manage pending (working) orders.
// ---------------------------------------------------------------------------

export const listBrokerPendingOrders = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const data = await oandaFetch(context.userId, "/pendingOrders");
    const orders = (data.orders ?? []) as Array<Record<string, unknown>>;
    return orders
      .filter((o) => ["LIMIT", "STOP", "MARKET_IF_TOUCHED"].includes(String(o.type ?? "")))
      .map((o) => ({
        id: String(o.id ?? ""),
        type: String(o.type ?? ""),
        instrument: String(o.instrument ?? ""),
        units: Number(o.units ?? 0),
        price: o.price ? Number(o.price) : null,
        createTime: String(o.createTime ?? ""),
        stopLoss: (o.stopLossOnFill as { price?: string } | undefined)?.price
          ? Number((o.stopLossOnFill as { price: string }).price) : null,
        takeProfit: (o.takeProfitOnFill as { price?: string } | undefined)?.price
          ? Number((o.takeProfitOnFill as { price: string }).price) : null,
      }));
  });

export const cancelBrokerOrder = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => z.object({ orderId: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    await oandaFetch(context.userId, `/orders/${encodeURIComponent(data.orderId)}/cancel`, { method: "PUT" });
    return { ok: true };
  });

const ModifyTradeInput = z.object({
  tradeId: z.string().min(1),
  stopLoss: z.number().positive().nullable().optional(),
  takeProfit: z.number().positive().nullable().optional(),
  trailingStopDistance: z.number().positive().nullable().optional(),
});

/** Replace/remove protective orders attached to an existing trade. */
export const modifyBrokerTrade = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => ModifyTradeInput.parse(raw))
  .handler(async ({ data, context }) => {
    const body: Record<string, unknown> = {};
    if (data.stopLoss !== undefined) {
      body.stopLoss = data.stopLoss === null ? null : { price: data.stopLoss.toString(), timeInForce: "GTC" };
    }
    if (data.takeProfit !== undefined) {
      body.takeProfit = data.takeProfit === null ? null : { price: data.takeProfit.toString(), timeInForce: "GTC" };
    }
    if (data.trailingStopDistance !== undefined) {
      body.trailingStopLoss = data.trailingStopDistance === null
        ? null
        : { distance: data.trailingStopDistance.toString(), timeInForce: "GTC" };
    }
    if (Object.keys(body).length === 0) throw new Error("Nothing to change on this trade");

    const resp = await oandaFetch(context.userId, `/trades/${encodeURIComponent(data.tradeId)}/orders`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    const rejects = ["stopLossOrderRejectTransaction", "takeProfitOrderRejectTransaction", "trailingStopLossOrderRejectTransaction"]
      .map((k) => resp[k] as Record<string, unknown> | undefined)
      .filter(Boolean);
    if (rejects.length > 0) {
      throw new Error(`OANDA rejected the change: ${String(rejects[0]?.reason ?? "invalid price")}`);
    }
    return { ok: true };
  });

/** Close a trade fully or partially (units = number of units to close). */
export const closeBrokerTradeUnits = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) =>
    z.object({ tradeId: z.string().min(1), units: z.number().positive().optional() }).parse(raw))
  .handler(async ({ data, context }) => {
    const resp = await oandaFetch(context.userId, `/trades/${encodeURIComponent(data.tradeId)}/close`, {
      method: "PUT",
      body: JSON.stringify({ units: data.units ? String(Math.floor(data.units)) : "ALL" }),
    });
    const reject = resp.orderRejectTransaction as Record<string, unknown> | undefined;
    if (reject) throw new Error(`OANDA rejected the close: ${String(reject.reason ?? "unknown")}`);
    const fill = resp.orderFillTransaction as Record<string, unknown> | undefined;
    return { ok: true, closedUnits: fill?.units ? Number(fill.units) : null, price: fill?.price ? Number(fill.price) : null };
  });

/** Full detail on one open trade, including current protective orders. */
export const getBrokerTrade = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => z.object({ tradeId: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    const resp = await oandaFetch(context.userId, `/trades/${encodeURIComponent(data.tradeId)}`);
    const t = (resp.trade ?? {}) as Record<string, unknown>;
    const sl = t.stopLossOrder as { price?: string } | undefined;
    const tp = t.takeProfitOrder as { price?: string } | undefined;
    return {
      id: String(t.id ?? ""),
      instrument: String(t.instrument ?? ""),
      currentUnits: Number(t.currentUnits ?? 0),
      price: Number(t.price ?? 0),
      unrealizedPL: Number(t.unrealizedPL ?? 0),
      stopLoss: sl?.price ? Number(sl.price) : null,
      takeProfit: tp?.price ? Number(tp.price) : null,
    };
  });
