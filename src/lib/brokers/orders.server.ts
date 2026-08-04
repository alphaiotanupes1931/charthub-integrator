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

/* ------------------------------ Tastytrade ----------------------------- */

async function orderTastytrade(c: Creds, env: string, o: OrderRequest): Promise<OrderResult> {
  const host = env === "live" ? "api.tastyworks.com" : "api.cert.tastyworks.com";
  const sess = await fetch(`https://${host}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ login: c.username, password: c.password }),
  });
  const s = await body(sess);
  if (!sess.ok) return httpFail(sess, s.text);
  const token = s.json?.data?.["session-token"];
  if (!token) return fail("Tastytrade did not return a session token.");
  const headers = { Authorization: token, "Content-Type": "application/json", Accept: "application/json" };

  let accountId = c.accountId?.trim();
  if (!accountId) {
    const acc = await fetch(`https://${host}/customers/me/accounts`, { headers });
    const a = await body(acc);
    accountId = a.json?.data?.items?.[0]?.account?.["account-number"];
    if (!accountId) return fail("Could not resolve a Tastytrade account number.");
  }
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const payload: Record<string, unknown> = {
    "order-type": o.type === "limit" ? "Limit" : "Market",
    "time-in-force": "Day",
    legs: [
      {
        "instrument-type": "Equity",
        symbol: o.symbol.toUpperCase(),
        quantity: Math.abs(Math.round(o.quantity)),
        action: o.side === "buy" ? "Buy to Open" : "Sell to Close",
      },
    ],
  };
  if (o.type === "limit") {
    payload.price = String(o.limitPrice);
    payload["price-effect"] = o.side === "buy" ? "Debit" : "Credit";
  }
  const res = await fetch(`https://${host}/accounts/${accountId}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  const id = json?.data?.order?.id;
  return { ok: true, detail: "Tastytrade order accepted.", orderId: id != null ? String(id) : undefined };
}

/* ------------------------------- Tradovate ----------------------------- */

async function orderTradovate(c: Creds, env: string, o: OrderRequest): Promise<OrderResult> {
  const host = env === "live" ? "live.tradovateapi.com" : "demo.tradovateapi.com";
  const auth = await fetch(`https://${host}/v1/auth/accesstokenrequest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      name: c.username,
      password: c.password,
      appId: "TradeMind",
      appVersion: "1.0",
      deviceId: c.apiKey || "trademind-web",
      cid: 0,
      sec: "",
    }),
  });
  const a = await body(auth);
  if (!auth.ok) return httpFail(auth, a.text);
  const token = a.json?.accessToken;
  if (!token) return fail(String(a.json?.errorText ?? "Tradovate did not return an access token."));
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  let accountSpec = c.accountId?.trim();
  let accountId: number | undefined;
  const list = await fetch(`https://${host}/v1/account/list`, { headers });
  const l = await body(list);
  const accounts: Array<{ id?: number; name?: string }> = Array.isArray(l.json) ? l.json : [];
  const match = accountSpec ? accounts.find((x) => x.name === accountSpec) : accounts[0];
  if (!match?.id) return fail("Could not resolve a Tradovate account.");
  accountId = match.id;
  accountSpec = match.name;

  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const payload: Record<string, unknown> = {
    accountId,
    accountSpec,
    symbol: o.symbol.toUpperCase(),
    action: o.side === "buy" ? "Buy" : "Sell",
    orderQty: Math.abs(Math.round(o.quantity)),
    orderType: o.type === "limit" ? "Limit" : "Market",
    isAutomated: true,
  };
  if (o.type === "limit") payload.price = o.limitPrice;
  const res = await fetch(`https://${host}/v1/order/placeorder`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.failureReason || json?.errorText) {
    return fail(String(json.failureText ?? json.failureReason ?? json.errorText));
  }
  return {
    ok: true,
    detail: "Tradovate order accepted.",
    orderId: json?.orderId != null ? String(json.orderId) : undefined,
  };
}

/* ------------------------------ Capital.com ---------------------------- */

async function orderCapital(c: Creds, env: string, o: OrderRequest): Promise<OrderResult> {
  const host = env === "live" ? "api-capital.backend-capital.com" : "demo-api-capital.backend-capital.com";
  const sess = await fetch(`https://${host}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": c.apiKey ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: c.username, password: c.password }),
  });
  const s = await body(sess);
  if (!sess.ok) return httpFail(sess, s.text);
  const cst = sess.headers.get("CST");
  const security = sess.headers.get("X-SECURITY-TOKEN");
  if (!cst || !security) return fail("Capital.com did not return session tokens.");
  const payload: Record<string, unknown> = {
    epic: o.symbol.toUpperCase(),
    direction: o.side.toUpperCase(),
    size: Math.abs(o.quantity),
  };
  if (o.stopLoss) payload.stopLevel = o.stopLoss;
  if (o.takeProfit) payload.profitLevel = o.takeProfit;
  const res = await fetch(`https://${host}/api/v1/positions`, {
    method: "POST",
    headers: {
      "X-CAP-API-KEY": c.apiKey ?? "",
      CST: cst,
      "X-SECURITY-TOKEN": security,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  return { ok: true, detail: "Capital.com position request accepted.", orderId: json?.dealReference };
}

/* --------------------------------- Bybit ------------------------------- */

async function orderBybit(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const payload: Record<string, unknown> = {
    category: "spot",
    symbol: o.symbol.replace(/[-/_]/g, "").toUpperCase(),
    side: o.side === "buy" ? "Buy" : "Sell",
    orderType: o.type === "limit" ? "Limit" : "Market",
    qty: String(Math.abs(o.quantity)),
  };
  if (o.type === "limit") payload.price = String(o.limitPrice);
  const bodyText = JSON.stringify(payload);
  const ts = String(Date.now());
  const recv = "5000";
  const sign = createHmac("sha256", c.apiSecret ?? "")
    .update(ts + (c.apiKey ?? "") + recv + bodyText)
    .digest("hex");
  const res = await fetch("https://api.bybit.com/v5/order/create", {
    method: "POST",
    headers: {
      "X-BAPI-API-KEY": c.apiKey ?? "",
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv,
      "X-BAPI-SIGN": sign,
      "Content-Type": "application/json",
    },
    body: bodyText,
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.retCode !== 0) return fail(String(json?.retMsg ?? "Bybit rejected the order."));
  return { ok: true, detail: "Bybit order accepted.", orderId: json?.result?.orderId };
}

/* ---------------------------------- OKX -------------------------------- */

async function orderOkx(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const path = "/api/v5/trade/order";
  const payload: Record<string, unknown> = {
    instId: o.symbol.toUpperCase(),
    tdMode: "cash",
    side: o.side,
    ordType: o.type === "limit" ? "limit" : "market",
    sz: String(Math.abs(o.quantity)),
  };
  if (o.type === "limit") payload.px = String(o.limitPrice);
  const bodyText = JSON.stringify(payload);
  const ts = new Date().toISOString();
  const sign = createHmac("sha256", c.apiSecret ?? "")
    .update(ts + "POST" + path + bodyText)
    .digest("base64");
  const res = await fetch(`https://www.okx.com${path}`, {
    method: "POST",
    headers: {
      "OK-ACCESS-KEY": c.apiKey ?? "",
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": c.passphrase ?? "",
      "Content-Type": "application/json",
    },
    body: bodyText,
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.code !== "0") {
    return fail(String(json?.data?.[0]?.sMsg ?? json?.msg ?? "OKX rejected the order."));
  }
  return { ok: true, detail: "OKX order accepted.", orderId: json?.data?.[0]?.ordId };
}

/* --------------------------------- KuCoin ------------------------------ */

async function orderKucoin(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const path = "/api/v1/orders";
  const payload: Record<string, unknown> = {
    clientOid: `tm-${Date.now()}`,
    symbol: o.symbol.toUpperCase(),
    side: o.side,
    type: o.type === "limit" ? "limit" : "market",
    size: String(Math.abs(o.quantity)),
  };
  if (o.type === "limit") payload.price = String(o.limitPrice);
  const bodyText = JSON.stringify(payload);
  const ts = String(Date.now());
  const secret = c.apiSecret ?? "";
  const sign = createHmac("sha256", secret).update(ts + "POST" + path + bodyText).digest("base64");
  const passSig = createHmac("sha256", secret).update(c.passphrase ?? "").digest("base64");
  const res = await fetch(`https://api.kucoin.com${path}`, {
    method: "POST",
    headers: {
      "KC-API-KEY": c.apiKey ?? "",
      "KC-API-SIGN": sign,
      "KC-API-TIMESTAMP": ts,
      "KC-API-PASSPHRASE": passSig,
      "KC-API-KEY-VERSION": "2",
      "Content-Type": "application/json",
    },
    body: bodyText,
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.code !== "200000") return fail(String(json?.msg ?? "KuCoin rejected the order."));
  return { ok: true, detail: "KuCoin order accepted.", orderId: json?.data?.orderId };
}

/* --------------------------------- Bitget ------------------------------ */

async function orderBitget(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const path = "/api/v2/spot/trade/place-order";
  const payload: Record<string, unknown> = {
    symbol: o.symbol.replace(/[-/_]/g, "").toUpperCase(),
    side: o.side,
    orderType: o.type === "limit" ? "limit" : "market",
    force: o.type === "limit" ? "gtc" : "gtc",
    size: String(Math.abs(o.quantity)),
  };
  if (o.type === "limit") payload.price = String(o.limitPrice);
  const bodyText = JSON.stringify(payload);
  const ts = String(Date.now());
  const sign = createHmac("sha256", c.apiSecret ?? "")
    .update(ts + "POST" + path + bodyText)
    .digest("base64");
  const res = await fetch(`https://api.bitget.com${path}`, {
    method: "POST",
    headers: {
      "ACCESS-KEY": c.apiKey ?? "",
      "ACCESS-SIGN": sign,
      "ACCESS-TIMESTAMP": ts,
      "ACCESS-PASSPHRASE": c.passphrase ?? "",
      "Content-Type": "application/json",
      locale: "en-US",
    },
    body: bodyText,
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.code !== "00000") return fail(String(json?.msg ?? "Bitget rejected the order."));
  return { ok: true, detail: "Bitget order accepted.", orderId: json?.data?.orderId };
}

/* --------------------------------- Kraken ------------------------------ */

async function orderKraken(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const path = "/0/private/AddOrder";
  const nonce = String(Date.now());
  const form = new URLSearchParams({
    nonce,
    ordertype: o.type === "limit" ? "limit" : "market",
    type: o.side,
    pair: o.symbol.replace(/[-/_]/g, "").toUpperCase(),
    volume: String(Math.abs(o.quantity)),
  });
  if (o.type === "limit") form.set("price", String(o.limitPrice));
  const post = form.toString();
  const hash = createHash("sha256").update(nonce + post).digest();
  const sign = createHmac("sha512", Buffer.from(c.apiSecret ?? "", "base64"))
    .update(Buffer.concat([Buffer.from(path, "utf8"), hash]))
    .digest("base64");
  const res = await fetch(`https://api.kraken.com${path}`, {
    method: "POST",
    headers: {
      "API-Key": c.apiKey ?? "",
      "API-Sign": sign,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: post,
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  const errors: string[] = Array.isArray(json?.error) ? json.error : [];
  if (errors.length) return fail(errors.join(", "));
  return { ok: true, detail: "Kraken order accepted.", orderId: json?.result?.txid?.[0] };
}

/* --------------------------------- Gemini ------------------------------ */

async function orderGemini(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  // Gemini has no market order type; a limit price is always required.
  if (!o.limitPrice) return fail("Gemini requires a limit price on every order.");
  const path = "/v1/order/new";
  const payload = {
    request: path,
    nonce: Date.now(),
    client_order_id: `tm-${Date.now()}`,
    symbol: o.symbol.replace(/[-/_]/g, "").toLowerCase(),
    amount: String(Math.abs(o.quantity)),
    price: String(o.limitPrice),
    side: o.side,
    type: "exchange limit",
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sign = createHmac("sha384", c.apiSecret ?? "").update(encoded).digest("hex");
  const res = await fetch(`https://api.gemini.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-GEMINI-APIKEY": c.apiKey ?? "",
      "X-GEMINI-PAYLOAD": encoded,
      "X-GEMINI-SIGNATURE": sign,
      "Cache-Control": "no-cache",
    },
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  if (json?.result === "error") return fail(String(json?.message ?? "Gemini rejected the order."));
  return { ok: true, detail: "Gemini order accepted.", orderId: json?.order_id };
}

/* --------------------------------- BitMEX ------------------------------ */

async function orderBitmex(c: Creds, _env: string, o: OrderRequest): Promise<OrderResult> {
  if (o.type === "limit" && !o.limitPrice) return fail("Limit price is required for a limit order.");
  const path = "/api/v1/order";
  const qty = Math.abs(Math.round(o.quantity));
  const payload: Record<string, unknown> = {
    symbol: o.symbol.replace(/[-/_]/g, "").toUpperCase(),
    orderQty: o.side === "buy" ? qty : -qty,
    ordType: o.type === "limit" ? "Limit" : "Market",
  };
  if (o.type === "limit") payload.price = o.limitPrice;
  const bodyText = JSON.stringify(payload);
  const expires = Math.floor(Date.now() / 1000) + 60;
  const sign = createHmac("sha256", c.apiSecret ?? "")
    .update("POST" + path + expires + bodyText)
    .digest("hex");
  const res = await fetch(`https://www.bitmex.com${path}`, {
    method: "POST",
    headers: {
      "api-key": c.apiKey ?? "",
      "api-expires": String(expires),
      "api-signature": sign,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: bodyText,
  });
  const { text, json } = await body(res);
  if (!res.ok) return httpFail(res, text);
  return { ok: true, detail: "BitMEX order accepted.", orderId: json?.orderID };
}

/* -------------------------------- router ------------------------------- */

/** Venues we can route live orders to today. */
export const TRADABLE_VENUES = [
  "oanda",
  "alpaca",
  "tradier",
  "binance",
  "coinbase",
  "tastytrade",
  "tradovate",
  "capitalcom",
  "bybit",
  "okx",
  "kucoin",
  "bitget",
  "kraken",
  "gemini",
  "bitmex",
] as const;


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
