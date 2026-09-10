// Venue-agnostic trading layer for the chart Buy/Sell bar and autopilot.
//
// Capital.com is the preferred execution venue because it covers the indices,
// metals, oil and crypto that most OANDA retail accounts refuse. OANDA is still
// supported for traders who already connected it. Credentials never leave the
// server: the client only sends order intent.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "@/lib/capability-middleware";

/** Cloud venues we can place orders at, best first. */
export const TRADE_VENUE_ORDER = ["capitalcom", "oanda"] as const;
export const VENUE_LABEL: Record<string, string> = {
  capitalcom: "Capital.com",
  oanda: "OANDA",
};

type Row = { broker: string; env: string; creds: Record<string, string> };

/** The venue this user's orders should go to, with decrypted credentials. */
export async function resolveTradeVenue(userId: string): Promise<Row | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_broker_credentials")
    .select("broker, env, api_key_ciphertext, is_active, updated_at")
    .eq("user_id", userId)
    .in("broker", TRADE_VENUE_ORDER as unknown as string[])
    .order("is_active", { ascending: false })
    .order("updated_at", { ascending: false });
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const picked =
    rows.find((r) => r.broker === "capitalcom") ?? rows.find((r) => r.broker === "oanda") ?? rows[0];
  const { decryptSecret } = await import("@/lib/broker-crypto.server");
  const plaintext = decryptSecret(picked.api_key_ciphertext as string);
  let creds: Record<string, string>;
  try {
    creds = JSON.parse(plaintext) as Record<string, string>;
  } catch {
    creds = { apiKey: plaintext };
  }
  return { broker: picked.broker as string, env: (picked.env as string) ?? "live", creds };
}

export type TradeStatus =
  | {
      connected: true;
      venue: string;
      venueName: string;
      env: string;
      accountId: string | null;
      currency: string | null;
      balance: number | null;
      marginAvailable: number | null;
      fundingUrl: string;
    }
  | { connected: false; venue: string | null; venueName: string | null; reason: string };

/** Account money and identity at whichever venue this user trades through. */
export const getTradeStatus = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }): Promise<TradeStatus> => {
    const venue = await resolveTradeVenue(context.userId);
    if (!venue) {
      const { oandaStatus } = await import("@/lib/broker-oanda.functions");
      const fallback = await oandaStatus(context.userId);
      if (fallback.connected) {
        return {
          connected: true,
          venue: "oanda",
          venueName: "OANDA",
          env: String(fallback.env),
          accountId: fallback.accountId,
          currency: fallback.currency,
          balance: fallback.balance,
          marginAvailable: fallback.marginAvailable,
          fundingUrl: fallback.fundingUrl,
        };
      }
      return {
        connected: false,
        venue: null,
        venueName: null,
        reason:
          "No trading account is connected yet. Connect Capital.com on the Broker page — it covers indices, gold, oil, crypto and forex.",
      };
    }

    if (venue.broker === "oanda") {
      const { oandaStatus } = await import("@/lib/broker-oanda.functions");
      const s = await oandaStatus(context.userId);
      if (!s.connected) {
        return { connected: false, venue: "oanda", venueName: "OANDA", reason: s.reason };
      }
      return {
        connected: true,
        venue: "oanda",
        venueName: "OANDA",
        env: String(s.env),
        accountId: s.accountId,
        currency: s.currency,
        balance: s.balance,
        marginAvailable: s.marginAvailable,
        fundingUrl: s.fundingUrl,
      };
    }

    try {
      const { capitalSession, capitalUrls } = await import("@/lib/venues/capital.server");
      const s = await capitalSession(venue.creds, venue.env);
      return {
        connected: true,
        venue: "capitalcom",
        venueName: "Capital.com",
        env: venue.env,
        accountId: s.accountId,
        currency: s.currency,
        balance: s.balance,
        marginAvailable: s.available,
        fundingUrl: capitalUrls(venue.env).fundingUrl,
      };
    } catch (e) {
      return {
        connected: false,
        venue: "capitalcom",
        venueName: "Capital.com",
        reason: (e as Error).message,
      };
    }
  });

const EstimateInput = z.object({
  symbol: z.string().min(1),
  units: z.number().positive().max(1_000_000),
});

export type TradeEstimate = {
  venue: string;
  instrument: string | null;
  price: number | null;
  bid: number | null;
  ask: number | null;
  marginRate: number | null;
  notional: number | null;
  required: number | null;
  currency: string;
  minSize: number | null;
  unavailable: string | null;
};

/** Roughly how much money this trade ties up at the trader's venue. */
export const estimateTradeMargin = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => EstimateInput.parse(raw))
  .handler(async ({ data, context }): Promise<TradeEstimate> => {
    const venue = await resolveTradeVenue(context.userId);
    const broker = venue?.broker ?? "oanda";

    if (broker === "oanda") {
      const { oandaEstimate } = await import("@/lib/broker-oanda.functions");
      try {
        const e = await oandaEstimate(context.userId, data);
        return { venue: "oanda", minSize: null, ...e };
      } catch (err) {
        return {
          venue: "oanda",
          instrument: null,
          price: null,
          bid: null,
          ask: null,
          marginRate: null,
          notional: null,
          required: null,
          currency: "USD",
          minSize: null,
          unavailable: (err as Error).message,
        };
      }
    }

    try {
      const { capitalSession, capitalEpic, capitalMarket } = await import("@/lib/venues/capital.server");
      const s = await capitalSession(venue!.creds, venue!.env);
      const epic = await capitalEpic(s, data.symbol);
      const m = await capitalMarket(s, epic);
      const notional = m.mid != null ? m.mid * data.units : null;
      const required = notional != null && m.marginFactor != null ? notional * m.marginFactor : null;
      return {
        venue: "capitalcom",
        instrument: epic,
        price: m.mid,
        bid: m.bid,
        ask: m.ask,
        marginRate: m.marginFactor,
        notional,
        required,
        currency: s.currency,
        minSize: m.minSize,
        unavailable:
          required == null ? "Capital.com is not returning margin details for this market right now." : null,
      };
    } catch (err) {
      return {
        venue: "capitalcom",
        instrument: null,
        price: null,
        bid: null,
        ask: null,
        marginRate: null,
        notional: null,
        required: null,
        currency: "USD",
        minSize: null,
        unavailable: (err as Error).message,
      };
    }
  });

const OrderInput = z.object({
  symbol: z.string().min(1),
  side: z.enum(["long", "short"]),
  units: z.number().positive().max(1_000_000),
  orderType: z.enum(["market", "limit", "stop"]).default("market"),
  price: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
});

export type TradeOrderResult = {
  ok: true;
  venue: string;
  venueName: string;
  orderId: string;
  pending: boolean;
  instrument: string;
  units: number;
  fillPrice: number | null;
  accountId: string;
  brokerUrl: string;
};

/** Send one live order to the trader's venue with stop and target attached. */
export const placeTradeOrder = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => OrderInput.parse(raw))
  .handler(async ({ data, context }): Promise<TradeOrderResult> => {
    const venue = await resolveTradeVenue(context.userId);
    const broker = venue?.broker ?? "oanda";

    if (broker === "oanda") {
      const { oandaPlaceOrder } = await import("@/lib/broker-oanda.functions");
      const r = await oandaPlaceOrder(context.userId, data);
      return { venue: "oanda", venueName: "OANDA", ...r, ok: true as const };
    }

    const { capitalSession, capitalPlaceOrder, capitalUrls } = await import("@/lib/venues/capital.server");
    const s = await capitalSession(venue!.creds, venue!.env);
    const r = await capitalPlaceOrder(s, {
      symbol: data.symbol,
      side: data.side,
      size: data.units,
      stopLoss: data.stopLoss ?? null,
      takeProfit: data.takeProfit ?? null,
    });
    return {
      ok: true,
      venue: "capitalcom",
      venueName: "Capital.com",
      orderId: r.orderId,
      pending: false,
      instrument: r.epic,
      units: data.side === "long" ? r.size : -r.size,
      fillPrice: r.fillPrice,
      accountId: r.accountId ?? "",
      brokerUrl: capitalUrls(venue!.env).brokerUrl,
    };
  });

/** Open positions at the trader's venue, in one shape. */
export const listTradePositions = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const venue = await resolveTradeVenue(context.userId);
    if (venue?.broker === "capitalcom") {
      const { capitalSession, capitalPositions } = await import("@/lib/venues/capital.server");
      const s = await capitalSession(venue.creds, venue.env);
      const rows = await capitalPositions(s);
      return rows.map((p) => ({
        id: p.dealId,
        instrument: p.epic,
        currentUnits: p.direction === "SELL" ? -p.size : p.size,
        price: p.openLevel ?? 0,
        unrealizedPL: p.upl ?? 0,
        openTime: "",
        stopLoss: p.stopLevel,
        takeProfit: p.profitLevel,
      }));
    }
    const { listBrokerPositions } = await import("@/lib/broker-oanda.functions");
    return listBrokerPositions();
  });
