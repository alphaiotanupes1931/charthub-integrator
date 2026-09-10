// Hands-off live execution for autopilot.
//
// Everything here runs server-side only. Credentials are loaded and decrypted
// per call and never returned to the client. Two jobs:
//   1. placeLiveOrder  - send one autopilot proposal to the trader's real venue
//                        with the stop and target attached on fill.
//   2. manageLiveTrades - once a trade is up by its own risk (1R), pull the
//                        stop to break-even. Targets are already resting at the
//                        venue, so "close at target" needs no polling.
import type { OandaCreds } from "@/lib/broker-readonly.server";

export type LiveOrderIntent = {
  symbol: string;
  side: "long" | "short";
  units: number;
  entry: number;
  stopLoss: number | null;
  takeProfit: number | null;
};

export type LiveOrderOutcome = { ok: boolean; detail: string; orderId?: string };

/** Marks trades autopilot opened, so management never touches a manual trade. */
export const AUTOPILOT_TAG = "trademind-autopilot";

/** Platform instrument label -> OANDA instrument code. */
export function oandaInstrument(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const map: Record<string, string> = {
    NAS100: "NAS100_USD",
    US100: "NAS100_USD",
    SPX500: "SPX500_USD",
    US500: "SPX500_USD",
    US30: "US30_USD",
    DJI: "US30_USD",
    GER40: "DE30_EUR",
    UK100: "UK100_GBP",
    JP225: "JP225_USD",
    XAUUSD: "XAU_USD",
    XAGUSD: "XAG_USD",
    WTI: "WTICO_USD",
    USOIL: "WTICO_USD",
    BTCUSD: "BTC_USD",
    ETHUSD: "ETH_USD",
  };
  if (map[s]) return map[s];
  const cleaned = s.replace(/[\s/\-]/g, "_");
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(cleaned)) return cleaned;
  if (/^[A-Z]{6}$/.test(cleaned)) return `${cleaned.slice(0, 3)}_${cleaned.slice(3)}`;
  return cleaned;
}

/** Price precision OANDA will accept for this instrument. */
function priceStr(instrument: string, price: number): string {
  const jpy = instrument.endsWith("_JPY");
  const metalOrIndex = /XAU|XAG|US30|NAS100|SPX500|DE30|UK100|JP225|WTICO|BTC|ETH/.test(instrument);
  const digits = metalOrIndex ? 2 : jpy ? 3 : 5;
  return price.toFixed(digits);
}

async function oandaTarget(userId: string) {
  const { loadOandaCreds, resolveOandaTarget } = await import("@/lib/broker-readonly.server");
  const creds: OandaCreds | null = await loadOandaCreds(userId);
  if (!creds) return null;
  const target = await resolveOandaTarget(creds);
  if (!target) return null;
  return { creds, ...target };
}

async function oandaSend(
  host: string,
  apiKey: string,
  path: string,
  method: "POST" | "PUT",
  payload: unknown,
) {
  const res = await fetch(`https://${host}/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  return { ok: res.ok, status: res.status, text, json };
}

/**
 * Market order at the trader's real OANDA account, with stop and target
 * attached so the position is protected the moment it fills.
 */
export async function placeLiveOrder(
  userId: string,
  venue: string,
  intent: LiveOrderIntent,
): Promise<LiveOrderOutcome> {
  if (venue === "capitalcom") {
    try {
      const { resolveTradeVenue } = await import("@/lib/broker-trade.functions");
      const row = await resolveTradeVenue(userId);
      if (!row || row.broker !== "capitalcom") {
        return { ok: false, detail: "No usable Capital.com account is connected." };
      }
      const { capitalSession, capitalPlaceOrder } = await import("@/lib/venues/capital.server");
      const session = await capitalSession(row.creds, row.env);
      const res = await capitalPlaceOrder(session, {
        symbol: intent.symbol,
        side: intent.side,
        size: Math.abs(intent.units),
        stopLoss: intent.stopLoss,
        takeProfit: intent.takeProfit,
      });
      return {
        ok: true,
        detail: `Opened ${intent.side} ${res.size} ${res.epic}${res.fillPrice ? ` at ${res.fillPrice}` : ""} on Capital.com.`,
        orderId: res.orderId,
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
  if (venue !== "oanda") {
    return { ok: false, detail: `Hands-off live execution is wired for Capital.com and OANDA, not ${venue}.` };
  }
  const target = await oandaTarget(userId);
  if (!target) return { ok: false, detail: "No usable OANDA account is connected." };


  const instrument = oandaInstrument(intent.symbol);
  const size = Math.max(1, Math.floor(Math.abs(intent.units)));
  const order: Record<string, unknown> = {
    instrument,
    units: String(intent.side === "long" ? size : -size),
    type: "MARKET",
    timeInForce: "FOK",
    positionFill: "DEFAULT",
  };
  // Tag so later trade management only ever touches autopilot's own trades.
  order.clientExtensions = { tag: AUTOPILOT_TAG, comment: "TradeMind autopilot" };
  if (intent.stopLoss) {
    order.stopLossOnFill = { price: priceStr(instrument, intent.stopLoss), timeInForce: "GTC" };
  }
  if (intent.takeProfit) {
    order.takeProfitOnFill = { price: priceStr(instrument, intent.takeProfit), timeInForce: "GTC" };
  }

  const res = await oandaSend(
    target.host,
    target.creds.apiKey,
    `/accounts/${target.accountId}/orders`,
    "POST",
    { order },
  );
  if (!res.ok) {
    return { ok: false, detail: `Venue rejected the order (HTTP ${res.status}): ${res.text.slice(0, 240)}` };
  }
  const reject = res.json["orderRejectTransaction"] as { rejectReason?: string } | undefined;
  if (reject?.rejectReason) {
    return { ok: false, detail: `Venue rejected the order: ${reject.rejectReason}` };
  }
  const fill = res.json["orderFillTransaction"] as { id?: string; price?: string } | undefined;
  const created = res.json["orderCreateTransaction"] as { id?: string } | undefined;
  const id = fill?.id ?? created?.id;
  return {
    ok: true,
    detail: `Filled ${intent.side} ${size} ${instrument}${fill?.price ? ` at ${fill.price}` : ""} on ${target.env === "live" ? "live" : "demo"} OANDA.`,
    orderId: id,
  };
}

export type ManageResult = {
  checked: number;
  movedToBreakEven: number;
  partialsTaken: number;
  trailed: number;
  notes: string[];
};

export type ManageOptions = {
  /** Move the stop to entry once the trade is ahead by its own risk. */
  breakEven?: boolean;
  /** Close half the position at the first target distance (1R). */
  partials?: boolean;
  /** Keep trailing the remainder once it is more than 2R ahead. */
  trail?: boolean;
};

/**
 * Trade management for filled live trades:
 *   - at 1R ahead, close half (optional) and move the stop to entry
 *   - beyond 2R, keep the stop trailing 1R behind price
 * Targets already rest at the venue and close themselves.
 */
export async function manageLiveTrades(
  userId: string,
  venue = "oanda",
  opts: ManageOptions = {},
): Promise<ManageResult> {
  const { breakEven = true, partials = false, trail = false } = opts;
  const out: ManageResult = { checked: 0, movedToBreakEven: 0, partialsTaken: 0, trailed: 0, notes: [] };
  if (venue !== "oanda") return out;

  const target = await oandaTarget(userId);
  if (!target) return out;
  const { oandaGet } = await import("@/lib/broker-readonly.server");

  const open = await oandaGet(target.host, target.creds.apiKey, `/accounts/${target.accountId}/openTrades`);
  const trades = Array.isArray(open.body["trades"])
    ? (open.body["trades"] as Array<Record<string, unknown>>)
    : [];
  if (!trades.length) return out;

  const instruments = [...new Set(trades.map((t) => String(t["instrument"] ?? "")))].filter(Boolean);
  const pricing = await oandaGet(
    target.host,
    target.creds.apiKey,
    `/accounts/${target.accountId}/pricing?instruments=${instruments.join(",")}`,
  );
  const priceRows = Array.isArray((pricing.body as Record<string, unknown> | undefined)?.["prices"])
    ? ((pricing.body as Record<string, unknown>)["prices"] as Array<Record<string, unknown>>)
    : [];
  const mid = new Map<string, number>();
  for (const row of priceRows) {
    const bid = Number((row["bids"] as Array<{ price?: string }> | undefined)?.[0]?.price);
    const ask = Number((row["asks"] as Array<{ price?: string }> | undefined)?.[0]?.price);
    if (Number.isFinite(bid) && Number.isFinite(ask)) {
      mid.set(String(row["instrument"]), (bid + ask) / 2);
    }
  }

  for (const t of trades) {
    const id = String(t["id"] ?? "");
    const instrument = String(t["instrument"] ?? "");
    const entry = Number(t["price"]);
    const units = Number(t["currentUnits"]);
    const initialUnits = Number(t["initialUnits"] ?? units);
    // Only trades autopilot opened itself. Anything the trader placed by hand
    // (or before tagging existed) is left completely alone.
    const tag = (t["clientExtensions"] as { tag?: string } | undefined)?.tag;
    if (tag !== AUTOPILOT_TAG) continue;
    const stopOrder = t["stopLossOrder"] as { price?: string } | undefined;
    const stop = Number(stopOrder?.price);
    const last = mid.get(instrument);
    if (!id || !Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(last as number)) continue;
    out.checked += 1;

    const long = units > 0;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) continue;
    const price = last as number;
    const openProfit = long ? price - entry : entry - price;
    if (openProfit < risk) continue;

    const alreadyPartial = Math.abs(units) < Math.abs(initialUnits) - 0.5;

    // 1) Bank half the position the first time it is a full 1R ahead.
    if (partials && !alreadyPartial) {
      const half = Math.floor(Math.abs(units) / 2);
      if (half >= 1) {
        const res = await oandaSend(
          target.host,
          target.creds.apiKey,
          `/accounts/${target.accountId}/trades/${id}/close`,
          "PUT",
          { units: String(half) },
        );
        if (res.ok) {
          out.partialsTaken += 1;
          out.notes.push(`${instrument}: first target paid, ${half} units closed and the rest left running`);
        } else {
          out.notes.push(`${instrument}: could not close part of the trade (HTTP ${res.status})`);
        }
      }
    }

    // 2) Protect the remainder: stop to entry, then trail 1R behind price.
    let desiredStop: number | null = null;
    const protectedAlready = long ? stop >= entry : stop <= entry;
    if (breakEven && !protectedAlready) desiredStop = entry;
    if (trail && openProfit >= risk * 2) {
      const trailStop = long ? price - risk : price + risk;
      const better = long ? trailStop > Math.max(stop, entry) : trailStop < Math.min(stop, entry);
      if (better) desiredStop = trailStop;
    }
    if (desiredStop === null) continue;

    const res = await oandaSend(
      target.host,
      target.creds.apiKey,
      `/accounts/${target.accountId}/trades/${id}/orders`,
      "PUT",
      { stopLoss: { price: priceStr(instrument, desiredStop), timeInForce: "GTC" } },
    );
    if (res.ok) {
      if (desiredStop === entry) {
        out.movedToBreakEven += 1;
        out.notes.push(`${instrument}: up more than 1R, stop moved to break-even at ${priceStr(instrument, entry)}`);
      } else {
        out.trailed += 1;
        out.notes.push(`${instrument}: stop trailed up to ${priceStr(instrument, desiredStop)}`);
      }
    } else {
      out.notes.push(`${instrument}: could not move the stop (HTTP ${res.status})`);
    }
  }

  return out;
}

