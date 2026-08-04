// Server-only broker verification adapters. Each adapter performs one
// read-only authenticated request and reports the account it reached.
// Never import this file from browser code.
import { createHmac, createHash } from "node:crypto";

export type Creds = {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  accountId?: string;
  username?: string;
  password?: string;
  token?: string;
};

export type VerifyResult = {
  ok: boolean;
  detail: string;
  accountLabel?: string;
};

function fail(detail: string): VerifyResult {
  return { ok: false, detail: detail.slice(0, 300) };
}

async function readBody(res: Response): Promise<{ text: string; json: unknown }> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { text, json };
}

function errText(status: number, text: string): string {
  return `HTTP ${status}: ${text.replace(/\s+/g, " ").slice(0, 200) || "no response body"}`;
}

function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const enc = (s: string) => Buffer.from(s, "utf8");

/* ------------------------------ adapters ------------------------------ */

async function verifyOanda(c: Creds, env: string): Promise<VerifyResult> {
  const host = env === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
  const res = await fetch(`https://${host}/v3/accounts`, {
    headers: { Authorization: `Bearer ${c.apiKey ?? ""}`, Accept: "application/json" },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const accounts = (pick(json, ["accounts"]) as Array<{ id?: string }> | undefined) ?? [];
  return {
    ok: true,
    detail: `${accounts.length} account(s) reachable`,
    accountLabel: c.accountId || accounts[0]?.id,
  };
}

async function verifyAlpaca(c: Creds, env: string): Promise<VerifyResult> {
  const host = env === "live" ? "api.alpaca.markets" : "paper-api.alpaca.markets";
  const res = await fetch(`https://${host}/v2/account`, {
    headers: {
      "APCA-API-KEY-ID": c.apiKey ?? "",
      "APCA-API-SECRET-KEY": c.apiSecret ?? "",
      Accept: "application/json",
    },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const equity = pick(json, ["equity"]);
  return {
    ok: true,
    detail: `Equity ${equity ?? "n/a"} ${String(pick(json, ["currency"]) ?? "")}`.trim(),
    accountLabel: String(pick(json, ["account_number"]) ?? ""),
  };
}

async function verifyTradier(c: Creds, env: string): Promise<VerifyResult> {
  const host = env === "live" ? "api.tradier.com" : "sandbox.tradier.com";
  const res = await fetch(`https://${host}/v1/user/profile`, {
    headers: { Authorization: `Bearer ${c.token ?? ""}`, Accept: "application/json" },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const name = pick(json, ["profile", "name"]);
  return { ok: true, detail: `Profile ${name ?? "loaded"}`, accountLabel: c.accountId };
}

async function verifyTastytrade(c: Creds, env: string): Promise<VerifyResult> {
  const host = env === "live" ? "api.tastyworks.com" : "api.cert.tastyworks.com";
  const res = await fetch(`https://${host}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ login: c.username, password: c.password }),
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  return {
    ok: true,
    detail: "Session created",
    accountLabel: String(pick(json, ["data", "user", "username"]) ?? c.username ?? ""),
  };
}

async function verifyTradovate(c: Creds, env: string): Promise<VerifyResult> {
  const host = env === "live" ? "live.tradovateapi.com" : "demo.tradovateapi.com";
  const res = await fetch(`https://${host}/v1/auth/accesstokenrequest`, {
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
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  if (pick(json, ["errorText"])) return fail(String(pick(json, ["errorText"])));
  if (!pick(json, ["accessToken"])) return fail("No access token returned");
  return { ok: true, detail: "Access token issued", accountLabel: c.username };
}

async function verifyCapital(c: Creds, env: string): Promise<VerifyResult> {
  const host = env === "live" ? "api-capital.backend-capital.com" : "demo-api-capital.backend-capital.com";
  const res = await fetch(`https://${host}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": c.apiKey ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: c.username, password: c.password }),
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  return {
    ok: true,
    detail: "Session created",
    accountLabel: String(pick(json, ["currentAccountId"]) ?? ""),
  };
}

async function verifyIG(c: Creds, env: string): Promise<VerifyResult> {
  const host = env === "live" ? "api.ig.com" : "demo-api.ig.com";
  const res = await fetch(`https://${host}/gateway/deal/session`, {
    method: "POST",
    headers: {
      "X-IG-API-KEY": c.apiKey ?? "",
      "Content-Type": "application/json",
      Accept: "application/json; charset=UTF-8",
      Version: "2",
    },
    body: JSON.stringify({ identifier: c.username, password: c.password }),
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  return {
    ok: true,
    detail: "Session created",
    accountLabel: String(pick(json, ["currentAccountId"]) ?? ""),
  };
}

async function verifyMetaApi(c: Creds): Promise<VerifyResult> {
  const res = await fetch("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts", {
    headers: { "auth-token": c.token ?? "", Accept: "application/json" },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const list = Array.isArray(json) ? (json as Array<{ _id?: string; login?: string }>) : [];
  const match = c.accountId ? list.find((a) => a._id === c.accountId) : list[0];
  if (c.accountId && !match) return fail("Token works but that account ID was not found");
  return {
    ok: true,
    detail: `${list.length} MT account(s) provisioned`,
    accountLabel: match?.login ? String(match.login) : c.accountId,
  };
}

async function verifyDeriv(c: Creds): Promise<VerifyResult> {
  const res = await fetch(
    `https://api.deriv.com/v1/website_status?app_id=1`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) return fail(errText(res.status, "Deriv API unreachable"));
  if (!c.token || c.token.length < 10) return fail("Token looks too short");
  // Deriv authorization is websocket-only; we validate reachability and token shape.
  return { ok: true, detail: "Token stored, Deriv API reachable (auth happens on trade)" };
}

async function verifyCoinbase(c: Creds): Promise<VerifyResult> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = "/accounts";
  const prehash = ts + "GET" + path;
  let sig: string;
  try {
    sig = createHmac("sha256", Buffer.from(c.apiSecret ?? "", "base64")).update(prehash).digest("base64");
  } catch {
    return fail("API secret must be base64 (Coinbase Exchange format)");
  }
  const res = await fetch(`https://api.exchange.coinbase.com${path}`, {
    headers: {
      "CB-ACCESS-KEY": c.apiKey ?? "",
      "CB-ACCESS-SIGN": sig,
      "CB-ACCESS-TIMESTAMP": ts,
      "CB-ACCESS-PASSPHRASE": c.passphrase ?? "",
      Accept: "application/json",
    },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const list = Array.isArray(json) ? json : [];
  return { ok: true, detail: `${list.length} wallet(s) visible` };
}

async function verifyBinance(c: Creds): Promise<VerifyResult> {
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const sig = createHmac("sha256", enc(c.apiSecret ?? "")).update(query).digest("hex");
  const res = await fetch(`https://api.binance.com/api/v3/account?${query}&signature=${sig}`, {
    headers: { "X-MBX-APIKEY": c.apiKey ?? "", Accept: "application/json" },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const balances = (pick(json, ["balances"]) as unknown[] | undefined) ?? [];
  return { ok: true, detail: `${balances.length} asset balance(s) visible` };
}

async function verifyBybit(c: Creds): Promise<VerifyResult> {
  const ts = Date.now().toString();
  const recv = "5000";
  const query = "accountType=UNIFIED";
  const sig = createHmac("sha256", enc(c.apiSecret ?? ""))
    .update(ts + (c.apiKey ?? "") + recv + query)
    .digest("hex");
  const res = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${query}`, {
    headers: {
      "X-BAPI-API-KEY": c.apiKey ?? "",
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv,
      "X-BAPI-SIGN": sig,
      Accept: "application/json",
    },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const code = pick(json, ["retCode"]);
  if (code !== 0) return fail(String(pick(json, ["retMsg"]) ?? "Bybit rejected the key"));
  return { ok: true, detail: "Unified account balance read" };
}

async function verifyOkx(c: Creds): Promise<VerifyResult> {
  const ts = new Date().toISOString();
  const path = "/api/v5/account/balance";
  const sig = createHmac("sha256", enc(c.apiSecret ?? "")).update(ts + "GET" + path).digest("base64");
  const res = await fetch(`https://www.okx.com${path}`, {
    headers: {
      "OK-ACCESS-KEY": c.apiKey ?? "",
      "OK-ACCESS-SIGN": sig,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": c.passphrase ?? "",
      Accept: "application/json",
    },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  if (pick(json, ["code"]) !== "0") return fail(String(pick(json, ["msg"]) ?? "OKX rejected the key"));
  return { ok: true, detail: "Account balance read" };
}

async function verifyKucoin(c: Creds): Promise<VerifyResult> {
  const ts = Date.now().toString();
  const path = "/api/v1/accounts";
  const sig = createHmac("sha256", enc(c.apiSecret ?? "")).update(ts + "GET" + path).digest("base64");
  const passSig = createHmac("sha256", enc(c.apiSecret ?? "")).update(c.passphrase ?? "").digest("base64");
  const res = await fetch(`https://api.kucoin.com${path}`, {
    headers: {
      "KC-API-KEY": c.apiKey ?? "",
      "KC-API-SIGN": sig,
      "KC-API-TIMESTAMP": ts,
      "KC-API-PASSPHRASE": passSig,
      "KC-API-KEY-VERSION": "2",
      Accept: "application/json",
    },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  if (pick(json, ["code"]) !== "200000") return fail(String(pick(json, ["msg"]) ?? "KuCoin rejected the key"));
  return { ok: true, detail: "Accounts read" };
}

async function verifyBitget(c: Creds): Promise<VerifyResult> {
  const ts = Date.now().toString();
  const path = "/api/v2/account/all-account-balance";
  const sig = createHmac("sha256", enc(c.apiSecret ?? "")).update(ts + "GET" + path).digest("base64");
  const res = await fetch(`https://api.bitget.com${path}`, {
    headers: {
      "ACCESS-KEY": c.apiKey ?? "",
      "ACCESS-SIGN": sig,
      "ACCESS-TIMESTAMP": ts,
      "ACCESS-PASSPHRASE": c.passphrase ?? "",
      "Content-Type": "application/json",
      locale: "en-US",
    },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  if (pick(json, ["code"]) !== "00000") return fail(String(pick(json, ["msg"]) ?? "Bitget rejected the key"));
  return { ok: true, detail: "Account balance read" };
}

async function verifyKraken(c: Creds): Promise<VerifyResult> {
  const path = "/0/private/Balance";
  const nonce = Date.now().toString();
  const body = `nonce=${nonce}`;
  let sig: string;
  try {
    const sha = createHash("sha256").update(nonce + body).digest();
    sig = createHmac("sha512", Buffer.from(c.apiSecret ?? "", "base64"))
      .update(Buffer.concat([enc(path), sha]))
      .digest("base64");
  } catch {
    return fail("Private key must be the base64 value from Kraken");
  }
  const res = await fetch(`https://api.kraken.com${path}`, {
    method: "POST",
    headers: {
      "API-Key": c.apiKey ?? "",
      "API-Sign": sig,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const errors = (pick(json, ["error"]) as string[] | undefined) ?? [];
  if (errors.length) return fail(errors.join(", "));
  return { ok: true, detail: "Balance read" };
}

async function verifyGemini(c: Creds): Promise<VerifyResult> {
  const path = "/v1/balances";
  const payload = Buffer.from(
    JSON.stringify({ request: path, nonce: Date.now() }),
    "utf8",
  ).toString("base64");
  const sig = createHmac("sha384", enc(c.apiSecret ?? "")).update(payload).digest("hex");
  const res = await fetch(`https://api.gemini.com${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-GEMINI-APIKEY": c.apiKey ?? "",
      "X-GEMINI-PAYLOAD": payload,
      "X-GEMINI-SIGNATURE": sig,
      "Cache-Control": "no-cache",
    },
  });
  const { text, json } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  const list = Array.isArray(json) ? json : [];
  return { ok: true, detail: `${list.length} balance row(s) visible` };
}

async function verifyBitmex(c: Creds): Promise<VerifyResult> {
  const path = "/api/v1/user/margin?currency=XBt";
  const expires = Math.floor(Date.now() / 1000) + 30;
  const sig = createHmac("sha256", enc(c.apiSecret ?? ""))
    .update("GET" + path + expires)
    .digest("hex");
  const res = await fetch(`https://www.bitmex.com${path}`, {
    headers: {
      "api-key": c.apiKey ?? "",
      "api-expires": String(expires),
      "api-signature": sig,
      Accept: "application/json",
    },
  });
  const { text } = await readBody(res);
  if (!res.ok) return fail(errText(res.status, text));
  return { ok: true, detail: "Margin account read" };
}

/* ------------------------------ dispatch ------------------------------ */

export async function verifyBroker(
  brokerId: string,
  creds: Creds,
  env: string,
): Promise<VerifyResult> {
  try {
    switch (brokerId) {
      case "oanda": return await verifyOanda(creds, env);
      case "alpaca": return await verifyAlpaca(creds, env);
      case "tradier": return await verifyTradier(creds, env);
      case "tastytrade": return await verifyTastytrade(creds, env);
      case "tradovate": return await verifyTradovate(creds, env);
      case "capitalcom": return await verifyCapital(creds, env);
      case "ig": return await verifyIG(creds, env);
      case "metaapi": return await verifyMetaApi(creds);
      case "deriv": return await verifyDeriv(creds);
      case "coinbase": return await verifyCoinbase(creds);
      case "binance": return await verifyBinance(creds);
      case "bybit": return await verifyBybit(creds);
      case "okx": return await verifyOkx(creds);
      case "kucoin": return await verifyKucoin(creds);
      case "bitget": return await verifyBitget(creds);
      case "kraken": return await verifyKraken(creds);
      case "gemini": return await verifyGemini(creds);
      case "bitmex": return await verifyBitmex(creds);
      default:
        return { ok: true, detail: "Stored. This broker has no cloud API to verify against." };
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Connection attempt failed");
  }
}
