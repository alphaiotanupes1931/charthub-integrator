// Capital.com trading venue. Server-only.
//
// Capital.com is used as the main cloud execution venue because it covers the
// instruments OANDA refuses on most retail accounts: US indices, gold/silver,
// oil and major crypto, alongside forex. Every call here logs in with the
// trader's stored credentials, so nothing is cached between requests.
import type { Creds } from "@/lib/brokers/adapters.server";

export type CapitalSession = {
  host: string;
  cst: string;
  security: string;
  accountId: string | null;
  currency: string;
  balance: number | null;
  available: number | null;
  env: string;
};

function hostFor(env: string): string {
  return env === "live"
    ? "api-capital.backend-capital.com"
    : "demo-api-capital.backend-capital.com";
}

/** Where the trader tops the account up / views the position. */
export function capitalUrls(env: string) {
  const base = env === "live" ? "https://capital.com/trading/platform/" : "https://capital.com/trading/platform/";
  return { brokerUrl: base, fundingUrl: "https://capital.com/trading/platform/deposit" };
}

async function readBody(res: Response): Promise<{ text: string; json: any }> {
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { text, json };
}

export function capitalError(status: number, json: any, text: string): string {
  const code = String(json?.errorCode ?? "").trim();
  const map: Record<string, string> = {
    "error.invalid.details": "Capital.com did not accept the login details saved for this account.",
    "error.not-different.accountId": "That is already the selected account.",
    "error.invalid.api.key": "The Capital.com API key saved here is not valid.",
    "error.too-many.requests": "Capital.com is rate limiting the app. Wait a moment and try again.",
  };
  if (code && map[code]) return map[code];
  if (/insufficient/i.test(code)) {
    return "There is not enough money available in the account for this trade size.";
  }
  if (code) return `Capital.com said: ${code.replace(/^error\./, "").replace(/[.-]/g, " ")}`;
  return `Capital.com request failed (${status})${text ? `: ${text.slice(0, 160)}` : ""}`;
}

/** Log in and return the session tokens plus account money. */
export async function capitalSession(creds: Creds, env: string): Promise<CapitalSession> {
  const host = hostFor(env);
  const res = await fetch(`https://${host}/api/v1/session`, {
    method: "POST",
    headers: { "X-CAP-API-KEY": creds.apiKey ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: creds.username, password: creds.password }),
  });
  const { text, json } = await readBody(res);
  if (!res.ok) throw new Error(capitalError(res.status, json, text));
  const cst = res.headers.get("CST") ?? "";
  const security = res.headers.get("X-SECURITY-TOKEN") ?? "";
  if (!cst || !security) throw new Error("Capital.com did not return a usable session.");
  const info = (json?.accountInfo ?? {}) as Record<string, unknown>;
  return {
    host,
    cst,
    security,
    accountId: (json?.currentAccountId as string | undefined) ?? creds.accountId ?? null,
    currency: String(json?.currencyIsoCode ?? "USD"),
    balance: Number.isFinite(Number(info.balance)) ? Number(info.balance) : null,
    available: Number.isFinite(Number(info.available)) ? Number(info.available) : null,
    env,
  };
}

async function capFetch(s: CapitalSession, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://${s.host}/api/v1${path}`, {
    ...init,
    headers: {
      CST: s.cst,
      "X-SECURITY-TOKEN": s.security,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const { text, json } = await readBody(res);
  return { ok: res.ok, status: res.status, json, text };
}

/** Platform symbol -> Capital.com epic for the markets traders scan here. */
const EPIC_MAP: Record<string, string> = {
  XAUUSD: "GOLD", GOLD: "GOLD", "XAU/USD": "GOLD",
  XAGUSD: "SILVER", SILVER: "SILVER", "XAG/USD": "SILVER",
  NAS100: "US100", US100: "US100", USTEC: "US100", NDX: "US100", NAS100USD: "US100",
  SPX500: "US500", US500: "US500", SPX: "US500", SPX500USD: "US500",
  US30: "US30", DJI: "US30", DOW: "US30", US30USD: "US30",
  GER40: "DE40", DE30: "DE40", DE40: "DE40",
  UK100: "UK100", JP225: "J225",
  WTI: "OIL_CRUDE", USOIL: "OIL_CRUDE", WTIUSD: "OIL_CRUDE", "WTI OIL": "OIL_CRUDE",
  UKOIL: "OIL_BRENT", BRENT: "OIL_BRENT",
  BTCUSD: "BTCUSD", ETHUSD: "ETHUSD", SOLUSD: "SOLUSD", XRPUSD: "XRPUSD",
};

function cleanSymbol(symbol: string): string[] {
  const raw = symbol.trim().toUpperCase();
  const inner = raw.match(/\(([^)]+)\)/)?.[1]?.trim();
  const out = [raw, inner ?? ""].filter(Boolean);
  for (const c of [...out]) {
    out.push(c.replace(/^[A-Z]+:/, "").replace(/[^A-Z0-9]/g, ""));
  }
  return [...new Set(out)];
}

/**
 * Resolve a platform symbol to a tradeable Capital.com epic. Mapped names win;
 * anything else is searched at the venue so new instruments still work.
 */
export async function capitalEpic(s: CapitalSession, symbol: string): Promise<string> {
  const candidates = cleanSymbol(symbol);
  for (const c of candidates) {
    if (EPIC_MAP[c]) return EPIC_MAP[c];
  }
  // Six-letter FX pairs are epics as-is on Capital.com (EURUSD, GBPJPY...).
  const six = candidates.find((c) => /^[A-Z]{6}$/.test(c));
  if (six) return six;

  const term = candidates[candidates.length - 1] ?? symbol;
  const found = await capFetch(s, `/markets?searchTerm=${encodeURIComponent(term)}`);
  const markets = Array.isArray(found.json?.markets) ? found.json.markets : [];
  const tradeable = markets.find((m: any) => String(m?.marketStatus ?? "") === "TRADEABLE") ?? markets[0];
  const epic = tradeable?.epic ? String(tradeable.epic) : null;
  if (!epic) {
    throw new Error(`Capital.com does not list a market for ${symbol}.`);
  }
  return epic;
}

export type CapitalMarket = {
  epic: string;
  bid: number | null;
  ask: number | null
  mid: number | null;
  marginFactor: number | null;
  minSize: number | null;
  status: string | null;
};

export async function capitalMarket(s: CapitalSession, epic: string): Promise<CapitalMarket> {
  const res = await capFetch(s, `/markets/${encodeURIComponent(epic)}`);
  if (!res.ok) throw new Error(capitalError(res.status, res.json, res.text));
  const snap = (res.json?.snapshot ?? {}) as Record<string, unknown>;
  const inst = (res.json?.instrument ?? {}) as Record<string, unknown>;
  const rules = (res.json?.dealingRules ?? {}) as Record<string, any>;
  const bid = Number.isFinite(Number(snap.bid)) ? Number(snap.bid) : null;
  const ask = Number.isFinite(Number(snap.offer)) ? Number(snap.offer) : null;
  const factor = Number(inst.marginFactor);
  return {
    epic,
    bid,
    ask,
    mid: bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask,
    // Capital.com reports margin as a percentage (e.g. 5 = 5%).
    marginFactor: Number.isFinite(factor) && factor > 0 ? factor / 100 : null,
    minSize: Number.isFinite(Number(rules?.minDealSize?.value)) ? Number(rules.minDealSize.value) : null,
    status: snap.marketStatus ? String(snap.marketStatus) : null,
  };
}

export type CapitalOrderIntent = {
  symbol: string;
  side: "long" | "short";
  size: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

export type CapitalOrderResult = {
  ok: true;
  orderId: string;
  dealId: string | null;
  epic: string;
  size: number;
  fillPrice: number | null;
  accountId: string | null;
  env: string;
};

/** Open one position with stop and target attached. */
export async function capitalPlaceOrder(
  s: CapitalSession,
  intent: CapitalOrderIntent,
): Promise<CapitalOrderResult> {
  const epic = await capitalEpic(s, intent.symbol);
  const market = await capitalMarket(s, epic).catch(() => null);
  if (market?.status && market.status !== "TRADEABLE") {
    throw new Error(`${intent.symbol} is not tradeable at Capital.com right now (market ${market.status.toLowerCase()}).`);
  }
  const size = market?.minSize ? Math.max(market.minSize, intent.size) : intent.size;
  const payload: Record<string, unknown> = {
    epic,
    direction: intent.side === "long" ? "BUY" : "SELL",
    size,
    guaranteedStop: false,
  };
  if (intent.stopLoss) payload.stopLevel = intent.stopLoss;
  if (intent.takeProfit) payload.profitLevel = intent.takeProfit;

  const res = await capFetch(s, "/positions", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(capitalError(res.status, res.json, res.text));
  const reference = String(res.json?.dealReference ?? "");
  if (!reference) throw new Error("Capital.com did not return an order reference.");

  // Confirm so the trader sees a real fill or the venue's own reason.
  const confirm = await capFetch(s, `/confirms/${encodeURIComponent(reference)}`);
  const status = String(confirm.json?.dealStatus ?? "");
  if (status === "REJECTED") {
    const reason = String(confirm.json?.rejectReason ?? confirm.json?.reason ?? "the order was turned down");
    if (/INSUFFICIENT|MARGIN|FUNDS/i.test(reason)) {
      throw new Error(
        `Not enough money available for ${size} of ${intent.symbol}. Lower the size or add funds, then try again.`,
      );
    }
    throw new Error(`Your broker did not accept the order: ${reason.replace(/_/g, " ").toLowerCase()}.`);
  }
  const level = Number(confirm.json?.level);
  return {
    ok: true,
    orderId: reference,
    dealId: confirm.json?.dealId ? String(confirm.json.dealId) : null,
    epic,
    size,
    fillPrice: Number.isFinite(level) && level > 0 ? level : market?.mid ?? null,
    accountId: s.accountId,
    env: s.env,
  };
}

export type CapitalPosition = {
  dealId: string;
  epic: string;
  direction: string;
  size: number;
  openLevel: number | null;
  upl: number | null;
  stopLevel: number | null;
  profitLevel: number | null;
};

export async function capitalPositions(s: CapitalSession): Promise<CapitalPosition[]> {
  const res = await capFetch(s, "/positions");
  if (!res.ok) throw new Error(capitalError(res.status, res.json, res.text));
  const rows = Array.isArray(res.json?.positions) ? res.json.positions : [];
  return rows.map((r: any) => {
    const p = r?.position ?? {};
    const m = r?.market ?? {};
    return {
      dealId: String(p.dealId ?? ""),
      epic: String(m.epic ?? ""),
      direction: String(p.direction ?? ""),
      size: Number(p.size ?? 0),
      openLevel: Number.isFinite(Number(p.level)) ? Number(p.level) : null,
      upl: Number.isFinite(Number(p.upl)) ? Number(p.upl) : null,
      stopLevel: Number.isFinite(Number(p.stopLevel)) ? Number(p.stopLevel) : null,
      profitLevel: Number.isFinite(Number(p.profitLevel)) ? Number(p.profitLevel) : null,
    };
  });
}
