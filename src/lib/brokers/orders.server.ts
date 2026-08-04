// Server-only order routing adapters. Each function places ONE order at the
// named venue using the caller's stored credentials. Never import from browser
// code. Read-only verification lives in adapters.server.ts.
import { createHmac } from "node:crypto";
import type { Creds } from "@/lib/brokers/adapters.server";

export type OrderRequest = {
  /** Venue-native symbol, e.g. EUR_USD, AAPL, BTC-USD, BTCUSDT */
  symbol: string;
  side: "buy" | "sell";
  /** Units / shares / contracts / base-asset quantity, venue dependent */
  quantity: number;
  /** market when omitted */
  type?: "market" | "limit";
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
};

export type OrderResult = {
  ok: boolean;
  detail: string;
  orderId?: string;
};

function fail(detail: string): OrderResult {
  return { ok: false, detail: detail.replace(/\s+/g, " ").slice(0, 300) };
}

async function body(res: Response): Promise<{ text: string; json: any }> {
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { text, json };
}

function httpFail(res: Response, text: string): OrderResult {
  return fail(`HTTP ${res.status}: ${text || "no response body"}`);
}

/* -------------------------------- OANDA -------------------------------- */

async function orderOanda(c: Creds, env: string, o: OrderRequest): Promise<OrderResult> {
  const host = env === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
  const headers = {
    Authorization: `Bearer ${c.apiKey ?? ""}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  let accountId = c.accountId?.trim();
  if (!accountId) {
    const acc = await fetch(`https://${host}/v3/accounts`, { headers });
    const { json } = await body(acc);
    accountId = json?.accounts?.[0]?.id;
    if (!accountId) return fail("Could not resolve an OANDA account id.");
  }
  const units = o.side === "buy" ? Math.abs(o.quantity) : -Math.abs(o.quantity);
  const order: Record<string, unknown> = {
    instrument: o.symbol,
    units: String(units),
    type: o.type === "limit" ? "LIMIT" : "MARKET",
    timeInForce: o.type === "limit" ? "GTC" : "FOK",
    positionFill: "DEFAULT",
  };
  if (o.type === "limit") {
    if (!o.limitPrice) return fail("Limit price is required for a limit order.");
    order.price = String(o.limitPrice);
  }
  if (o.stopLoss) order.stopLossOnFill = { price: String(o.stopLoss), timeInForce: "GTC" };
  if (o.takeProfit) order.takeProfitOnFill = { price: String(o.takeProfit), timeInForce: "GTC" };

  const res = await fetch(`https://${host}/v3/accounts/${accountId}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({ order }),
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  const id =
    json?.orderFillTransaction?.id ?? json?.orderCreateTransaction?.id ?? undefined;
  return { ok: true, detail: `OANDA order accepted${id ? ` (#${id})` : ""}.`, orderId: id };
}

/* -------------------------------- Alpaca ------------------------------- */

async function orderAlpaca(c: Creds, env: string, o: OrderRequest): Promise<OrderResult> {
  const host = env === "live" ? "api.alpaca.markets" : "paper-api.alpaca.markets";
  const payload: Record<string, unknown> = {
    symbol: o.symbol,
    qty: String(Math.abs(o.quantity)),
    side: o.side,
    type: o.type === "limit" ? "limit" : "market",
    time_in_force: "day",
  };
  if (o.type === "limit") {
    if (!o.limitPrice) return fail("Limit price is required for a limit order.");
    payload.limit_price = String(o.limitPrice);
  }
  // Alpaca brackets require both legs.
  if (o.stopLoss && o.takeProfit) {
    payload.order_class = "bracket";
    payload.stop_loss = { stop_price: String(o.stopLoss) };
    payload.take_profit = { limit_price: String(o.takeProfit) };
  }
  const res = await fetch(`https://${host}/v2/orders`, {
    method: "POST",
    headers: {
      "APCA-API-KEY-ID": c.apiKey ?? "",
      "APCA-API-SECRET-KEY": c.apiSecret ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  return { ok: true, detail: `Alpaca order ${json?.status ?? "accepted"}.`, orderId: json?.id };
}

/* -------------------------------- Tradier ------------------------------ */

async function orderTradier(c: Creds, env: string, o: OrderRequest): Promise<OrderResult> {
  const host = env === "live" ? "api.tradier.com" : "sandbox.tradier.com";
  const headers = {
    Authorization: `Bearer ${c.apiKey ?? ""}`,
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  let accountId = c.accountId?.trim();
  if (!accountId) {
    const prof = await fetch(`https://${host}/v1/user/profile`, { headers });
    const { json } = await body(prof);
    const acc = json?.profile?.account;
    accountId = Array.isArray(acc) ? acc[0]?.account_number : acc?.account_number;
    if (!accountId) return fail("Could not resolve a Tradier account number.");
  }
  const form = new URLSearchParams({
    class: "equity",
    symbol: o.symbol,
    side: o.side, // buy | sell
    quantity: String(Math.abs(Math.round(o.quantity))),
    type: o.type === "limit" ? "limit" : "market",
    duration: "day",
  });
  if (o.type === "limit") {
    if (!o.limitPrice) return fail("Limit price is required for a limit order.");
    form.set("price", String(o.limitPrice));
  }
  const res = await fetch(`https://${host}/v1/accounts/${accountId}/orders`, {
    method: "POST",
    headers,
    body: form.toString(),
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.errors) return fail(JSON.stringify(json.errors));
  return {
    ok: true,
    detail: `Tradier order ${json?.order?.status ?? "accepted"}.`,
    orderId: json?.order?.id != null ? String(json.order.id) : undefined,
  };
}

/* -------------------------------- Binance ------------------------------ */

async function orderBinance(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  const params = new URLSearchParams({
    symbol: o.symbol.replace(/[-/_]/g, "").toUpperCase(),
    side: o.side.toUpperCase(),
    type: o.type === "limit" ? "LIMIT" : "MARKET",
    quantity: String(Math.abs(o.quantity)),
    timestamp: String(Date.now()),
    recvWindow: "5000",
  });
  if (o.type === "limit") {
    if (!o.limitPrice) return fail("Limit price is required for a limit order.");
    params.set("price", String(o.limitPrice));
    params.set("timeInForce", "GTC");
  }
  const signature = createHmac("sha256", c.apiSecret ?? "").update(params.toString()).digest("hex");
  params.set("signature", signature);
  const res = await fetch(`https://api.binance.com/api/v3/order?${params.toString()}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": c.apiKey ?? "" },
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  return {
    ok: true,
    detail: `Binance order ${json?.status ?? "accepted"}.`,
    orderId: json?.orderId != null ? String(json.orderId) : undefined,
  };
}

/* ------------------------------- Coinbase ------------------------------ */

async function orderCoinbase(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  const path = "/api/v3/brokerage/orders";
  const configuration =
    o.type === "limit"
      ? {
          limit_limit_gtc: {
            base_size: String(Math.abs(o.quantity)),
            limit_price: String(o.limitPrice ?? 0),
            post_only: false,
          },
        }
      : { market_market_ioc: { base_size: String(Math.abs(o.quantity)) } };
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");

  const payload = {
    client_order_id: `tm-${Date.now()}`,
    product_id: o.symbol.toUpperCase(),
    side: o.side.toUpperCase(),
    order_configuration: configuration,
  };
  const bodyText = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", c.apiSecret ?? "")
    .update(timestamp + "POST" + path + bodyText)
    .digest("hex");
  const res = await fetch(`https://api.coinbase.com${path}`, {
    method: "POST",
    headers: {
      "CB-ACCESS-KEY": c.apiKey ?? "",
      "CB-ACCESS-SIGN": signature,
      "CB-ACCESS-TIMESTAMP": timestamp,
      "Content-Type": "application/json",
    },
    body: bodyText,
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.success === false) {
    return fail(json?.error_response?.message ?? "Coinbase rejected the order.");
  }
  return {
    ok: true,
    detail: "Coinbase order accepted.",
    orderId: json?.success_response?.order_id ?? json?.order_id,
  };
}

/* -------------------------------- router ------------------------------- */

/** Venues we can route live orders to today. */
export const TRADABLE_VENUES = ["oanda", "alpaca", "tradier", "binance", "coinbase"] as const;

export async function placeOrderAt(
  broker: string,
  creds: Creds,
  env: string,
  order: OrderRequest,
): Promise<OrderResult> {
  if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
    return fail("Quantity must be greater than zero.");
  }
  try {
    switch (broker) {
      case "oanda": return await orderOanda(creds, env, order);
      case "alpaca": return await orderAlpaca(creds, env, order);
      case "tradier": return await orderTradier(creds, env, order);
      case "binance": return await orderBinance(creds, env, order);
      case "coinbase": return await orderCoinbase(creds, env, order);
      default:
        return fail("Order routing is not available for this venue yet.");
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Order request failed.");
  }
}
