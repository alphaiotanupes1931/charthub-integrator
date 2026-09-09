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
  if (venue !== "oanda") {
    return { ok: false, detail: `Hands-off live execution is only wired for OANDA right now, not ${venue}.` };
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

export type ManageResult = { checked: number; movedToBreakEven: number; notes: string[] };

/**
 * Trade management: as soon as an open trade is ahead by the distance it was
 * risking, the stop moves to entry so the trade cannot lose any more. Targets
 * already rest at the venue and close themselves.
 */
export async function manageLiveTrades(userId: string, venue = "oanda"): Promise<ManageResult> {
  const out: ManageResult = { checked: 0, movedToBreakEven: 0, notes: [] };
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
    const stopOrder = t["stopLossOrder"] as { price?: string } | undefined;
    const stop = Number(stopOrder?.price);
    const last = mid.get(instrument);
    if (!id || !Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(last as number)) continue;
    out.checked += 1;

    const long = units > 0;
    const risk = Math.abs(entry - stop);
    if (risk <= 0) continue;
    const openProfit = long ? (last as number) - entry : entry - (last as number);
    const alreadyProtected = long ? stop >= entry : stop <= entry;
    if (alreadyProtected || openProfit < risk) continue;

    const res = await oandaSend(
      target.host,
      target.creds.apiKey,
      `/accounts/${target.accountId}/trades/${id}/orders`,
      "PUT",
      { stopLoss: { price: priceStr(instrument, entry), timeInForce: "GTC" } },
    );
    if (res.ok) {
      out.movedToBreakEven += 1;
      out.notes.push(`${instrument}: up more than 1R, stop moved to break-even at ${priceStr(instrument, entry)}`);
    } else {
      out.notes.push(`${instrument}: could not move the stop (HTTP ${res.status})`);
    }
  }

  return out;
}
