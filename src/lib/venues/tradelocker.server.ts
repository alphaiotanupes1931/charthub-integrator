// TradeLocker trading venue. Server-only.
//
// TradeLocker is the main execution venue: it covers the indices, metals, oil
// and crypto that most OANDA retail accounts refuse, and it has a real
// credential login (email + password + server) so the trader connects it once.
// Credentials are decrypted per request and never leave the server.
import { tlBase, tlFetch, tlSession, type TLAccount, type TLEnv } from "@/lib/broker-tradelocker.server";

export type TLTradeSession = {
  env: TLEnv;
  token: string;
  accountId: string;
  accNum: string;
  balance: number | null;
  currency: string | null;
};

export function tradeLockerUrls(env: TLEnv) {
  const base = env === "live" ? "https://live.tradelocker.com/" : "https://demo.tradelocker.com/";
  return { brokerUrl: base, fundingUrl: base };
}

function headers(s: TLTradeSession): Record<string, string> {
  return { Authorization: `Bearer ${s.token}`, accNum: s.accNum, "Content-Type": "application/json" };
}

/** Log in with the saved TradeLocker credentials and pick the active account. */
export async function tradeLockerSession(userId: string): Promise<TLTradeSession> {
  const session = await tlSession(userId);
  if (!session) throw new Error("No TradeLocker login is saved yet.");
  const account = session.account as TLAccount | undefined;
  if (!account) throw new Error("This TradeLocker login has no trading accounts attached.");
  return {
    env: session.creds.env,
    token: session.token,
    accountId: String(account.id),
    accNum: String(account.accNum ?? account.id),
    balance: Number.isFinite(Number(account.accountBalance)) ? Number(account.accountBalance) : null,
    currency: account.currency ?? null,
  };
}

type TLInstrument = {
  tradableInstrumentId: number;
  name: string;
  tradeRouteId: number | null;
  infoRouteId: number | null;
};

function normalize(symbol: string): string[] {
  const raw = symbol.trim().toUpperCase();
  const inner = raw.match(/\(([^)]+)\)/)?.[1]?.trim() ?? "";
  const out = [raw, inner].filter(Boolean);
  for (const c of [...out]) {
    out.push(c.replace(/^[A-Z]+:/, "").replace(/[^A-Z0-9]/g, ""));
  }
  const aliases: Record<string, string[]> = {
    XAUUSD: ["GOLD", "XAUUSD"],
    XAGUSD: ["SILVER", "XAGUSD"],
    NAS100: ["NAS100", "US100", "USTEC", "NDX100"],
    US100: ["US100", "NAS100", "USTEC"],
    SPX500: ["US500", "SPX500", "SP500"],
    US500: ["US500", "SPX500"],
    US30: ["US30", "DJI30", "DOW"],
    WTI: ["USOIL", "WTI", "XTIUSD"],
    USOIL: ["USOIL", "WTI", "XTIUSD"],
    BTCUSD: ["BTCUSD", "BTCUSDT"],
    ETHUSD: ["ETHUSD", "ETHUSDT"],
    SOLUSD: ["SOLUSD", "SOLUSDT"],
  };
  for (const c of [...out]) {
    for (const a of aliases[c] ?? []) out.push(a);
  }
  return [...new Set(out)];
}

/** All instruments this TradeLocker account can trade. */
async function instruments(s: TLTradeSession): Promise<TLInstrument[]> {
  const resp = await tlFetch<{ d?: { instruments?: unknown[] }; instruments?: unknown[] }>(
    `${tlBase(s.env)}/trade/accounts/${s.accountId}/instruments`,
    { headers: headers(s) },
    "Loading TradeLocker instruments failed",
  );
  const rows = (resp.d?.instruments ?? resp.instruments ?? []) as Record<string, unknown>[];
  return rows.map((r) => {
    const routes = (r.routes ?? []) as { id?: number; type?: string }[];
    return {
      tradableInstrumentId: Number(r.tradableInstrumentId ?? r.id),
      name: String(r.name ?? r.symbol ?? ""),
      tradeRouteId: routes.find((x) => String(x.type).toUpperCase() === "TRADE")?.id ?? null,
      infoRouteId: routes.find((x) => String(x.type).toUpperCase() === "INFO")?.id ?? null,
    };
  });
}

/** Map a platform symbol onto a TradeLocker instrument the account holds. */
export async function tradeLockerInstrument(s: TLTradeSession, symbol: string): Promise<TLInstrument> {
  const list = await instruments(s);
  const key = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wanted = normalize(symbol).map(key);
  for (const w of wanted) {
    const exact = list.find((i) => key(i.name) === w);
    if (exact) return exact;
  }
  for (const w of wanted) {
    const partial = list.find((i) => key(i.name).startsWith(w) || key(i.name).includes(w));
    if (partial) return partial;
  }
  throw new Error(`TradeLocker does not list ${symbol} on this account.`);
}

export type TLQuote = { bid: number | null; ask: number | null; mid: number | null };

export async function tradeLockerQuote(s: TLTradeSession, inst: TLInstrument): Promise<TLQuote> {
  if (inst.infoRouteId == null) return { bid: null, ask: null, mid: null };
  const resp = await tlFetch<{ d?: Record<string, unknown> }>(
    `${tlBase(s.env)}/trade/quotes?routeId=${inst.infoRouteId}&tradableInstrumentId=${inst.tradableInstrumentId}`,
    { headers: headers(s) },
    "Loading the TradeLocker price failed",
  );
  const d = resp.d ?? {};
  const bid = Number(d.bp ?? d.bid);
  const ask = Number(d.ap ?? d.ask);
  const b = Number.isFinite(bid) && bid > 0 ? bid : null;
  const a = Number.isFinite(ask) && ask > 0 ? ask : null;
  return { bid: b, ask: a, mid: b != null && a != null ? (b + a) / 2 : (b ?? a) };
}

/** Margin rate for one instrument, when the venue publishes it. */
export async function tradeLockerMarginRate(s: TLTradeSession, inst: TLInstrument): Promise<number | null> {
  if (inst.infoRouteId == null) return null;
  try {
    const resp = await tlFetch<{ d?: Record<string, unknown> }>(
      `${tlBase(s.env)}/trade/instruments/${inst.tradableInstrumentId}?routeId=${inst.infoRouteId}&locale=en`,
      { headers: headers(s) },
      "Loading TradeLocker instrument details failed",
    );
    const d = resp.d ?? {};
    const raw = Number(d.marginRate ?? d.margin ?? (d as { marginFactor?: number }).marginFactor);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw > 1 ? raw / 100 : raw;
  } catch {
    return null;
  }
}

export type TLOrderIntent = {
  symbol: string;
  side: "long" | "short";
  size: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

export type TLOrderResult = {
  orderId: string;
  instrument: string;
  size: number;
  fillPrice: number | null;
  accountId: string;
  env: TLEnv;
};

/** Send one market order with stop and target attached. */
export async function tradeLockerPlaceOrder(s: TLTradeSession, intent: TLOrderIntent): Promise<TLOrderResult> {
  const inst = await tradeLockerInstrument(s, intent.symbol);
  if (inst.tradeRouteId == null) {
    throw new Error(`${intent.symbol} cannot be traded on this TradeLocker account.`);
  }
  const quote = await tradeLockerQuote(s, inst).catch(() => ({ bid: null, ask: null, mid: null }) as TLQuote);
  const body: Record<string, unknown> = {
    price: 0,
    qty: intent.size,
    routeId: inst.tradeRouteId,
    side: intent.side === "long" ? "buy" : "sell",
    validity: "IOC",
    tradableInstrumentId: inst.tradableInstrumentId,
    type: "market",
  };
  if (intent.stopLoss) {
    body.stopLoss = intent.stopLoss;
    body.stopLossType = "absolute";
  }
  if (intent.takeProfit) {
    body.takeProfit = intent.takeProfit;
    body.takeProfitType = "absolute";
  }

  let resp: { d?: { orderId?: string | number }; orderId?: string | number };
  try {
    resp = await tlFetch(
      `${tlBase(s.env)}/trade/accounts/${s.accountId}/orders`,
      { method: "POST", headers: headers(s), body: JSON.stringify(body) },
      "Order rejected",
    );
  } catch (e) {
    const msg = (e as Error).message;
    if (/margin|fund|balance|insufficient/i.test(msg)) {
      throw new Error(
        `There is not enough money available for ${intent.size} of ${intent.symbol}. Lower the size or add funds, then try again.`,
      );
    }
    throw new Error(`Your broker did not accept the order: ${msg.replace(/^Order rejected:\s*/i, "")}`);
  }
  const orderId = String(resp.d?.orderId ?? resp.orderId ?? "");
  return {
    orderId: orderId || "pending",
    instrument: inst.name,
    size: intent.size,
    fillPrice: quote.mid,
    accountId: s.accountId,
    env: s.env,
  };
}

export type TLPositionRow = {
  id: string;
  instrument: string;
  units: number;
  price: number;
  unrealizedPL: number;
  stopLoss: number | null;
  takeProfit: number | null;
};

/** Open positions, best-effort: TradeLocker returns array rows, not objects. */
export async function tradeLockerPositions(s: TLTradeSession): Promise<TLPositionRow[]> {
  try {
    const resp = await tlFetch<{ d?: { positions?: unknown[] } }>(
      `${tlBase(s.env)}/trade/accounts/${s.accountId}/positions`,
      { headers: headers(s) },
      "Loading TradeLocker positions failed",
    );
    const rows = (resp.d?.positions ?? []) as unknown[];
    return rows
      .map((row) => {
        if (!Array.isArray(row)) return null;
        // [id, tradableInstrumentId, routeId, side, qty, avgPrice, ...]
        const qty = Number(row[4]);
        const price = Number(row[5]);
        const short = String(row[3] ?? "").toLowerCase().startsWith("s");
        const out: TLPositionRow = {
          id: String(row[0] ?? ""),
          instrument: String(row[1] ?? ""),
          units: Number.isFinite(qty) ? (short ? -qty : qty) : 0,
          price: Number.isFinite(price) ? price : 0,
          unrealizedPL: 0,
          stopLoss: null,
          takeProfit: null,
        };
        return out;
      })
      .filter((r): r is TLPositionRow => r !== null);
  } catch {
    return [];
  }
}
