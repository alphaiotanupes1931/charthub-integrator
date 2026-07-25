// OANDA v20 broker integration. Loads each user's encrypted credentials from
// public.user_broker_credentials; falls back to project-level OANDA_API_KEY/
// OANDA_ACCOUNT_ID env vars when a user has not saved their own.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
};

function toOandaInstrument(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (OANDA_MAP[s]) return OANDA_MAP[s];
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(s)) return s;
  return null;
}

function hostFor(env: OandaEnv): OandaEndpoint {
  return env === "live"
    ? { host: "api-fxtrade.oanda.com", env: "live" }
    : { host: "api-fxpractice.oanda.com", env: "practice" };
}

function endpointsFor(preferred: OandaEnv): OandaEndpoint[] {
  const other: OandaEnv = preferred === "live" ? "practice" : "live";
  return [hostFor(preferred), hostFor(other)];
}

async function loadUserOandaConfig(userId: string): Promise<OandaConfig | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_broker_credentials")
    .select("api_key_ciphertext, account_id, env")
    .eq("user_id", userId)
    .eq("broker", "oanda")
    .maybeSingle();
  if (!data) return null;
  const { decryptSecret } = await import("@/lib/broker-crypto.server");
  return {
    apiKey: decryptSecret(data.api_key_ciphertext),
    accountId: data.account_id?.trim() || undefined,
    preferredEnv: (data.env as OandaEnv) ?? "practice",
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
  const endpoints = endpointsFor(cfg.preferredEnv);
  const failedMessages: string[] = [];

  if (cfg.accountId) {
    for (const endpoint of endpoints) {
      const summary = await tryOandaFetch(endpoint, cfg.accountId, cfg.apiKey, "/summary", { method: "GET" });
      if (summary.res.ok) {
        return { apiKey: cfg.apiKey, accountId: cfg.accountId, configuredAccountId: cfg.accountId, source: cfg.source, ...endpoint, discovered: false };
      }
      failedMessages.push(`${endpoint.env}: ${oandaErrorMessage(summary.body, summary.res.status)}`);
    }
  }

  for (const endpoint of endpoints) {
    const listed = await listOandaAccounts(endpoint, cfg.apiKey);
    if (!listed.ok) {
      failedMessages.push(`${endpoint.env}: ${oandaErrorMessage(listed.body, listed.status)}`);
      continue;
    }
    const discoveredId = listed.accounts.find((a) => typeof a.id === "string" && a.id.trim().length > 0)?.id;
    if (discoveredId) {
      return { apiKey: cfg.apiKey, accountId: discoveredId, configuredAccountId: cfg.accountId, source: cfg.source, ...endpoint, discovered: true };
    }
    failedMessages.push(`${endpoint.env}: no accounts available for this API key`);
  }

  const suffix = failedMessages.length > 0 ? ` ${failedMessages.join("; ")}` : "";
  throw new Error(`The saved OANDA key is not authorized for any account.${suffix}`);
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

export const getBrokerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const account = await oandaFetch(context.userId, "/summary");
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
      };
    } catch (e) {
      return { connected: false as const, reason: (e as Error).message };
    }
  });

export const listBrokerPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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
  .handler(async ({ data, context }) => {
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

    const resp = await oandaFetch(context.userId, "/orders", {
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
    };
  });

export const closeBrokerTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ tradeId: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    await oandaFetch(context.userId, `/trades/${encodeURIComponent(data.tradeId)}/close`, {
      method: "PUT",
      body: JSON.stringify({ units: "ALL" }),
    });
    return { ok: true };
  });
