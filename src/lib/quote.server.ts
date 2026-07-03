// Server-only helper: fetch a latest spot price for a symbol.
// Uses OANDA first (real FX/metals/indices), falls back to Twelve Data.

const OANDA_MAP: Record<string, string> = {
  "EUR/USD": "EUR_USD",
  "GBP/USD": "GBP_USD",
  "USD/JPY": "USD_JPY",
  "USD/CHF": "USD_CHF",
  "AUD/USD": "AUD_USD",
  "NZD/USD": "NZD_USD",
  "USD/CAD": "USD_CAD",
  "XAU/USD": "XAU_USD",
  "XAG/USD": "XAG_USD",
  "NAS100": "NAS100_USD",
  "SPX500": "SPX500_USD",
  "US30": "US30_USD",
  "WTI OIL": "WTICO_USD",
};

function normalize(sym: string): string {
  return sym.trim().toUpperCase();
}

async function fetchOandaSpot(instrument: string): Promise<number | null> {
  const apiKey = process.env.OANDA_API_KEY;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!apiKey || !accountId) return null;
  const env = (process.env.OANDA_ENV ?? "live").toLowerCase();
  const host = env === "practice" ? "api-fxpractice.oanda.com" : "api-fxtrade.oanda.com";
  const url = `https://${host}/v3/accounts/${accountId}/pricing?instruments=${instrument}`;
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      prices?: Array<{ bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }>;
    };
    const p = json.prices?.[0];
    const bid = p?.bids?.[0]?.price ? parseFloat(p.bids[0].price) : null;
    const ask = p?.asks?.[0]?.price ? parseFloat(p.asks[0].price) : null;
    if (bid != null && ask != null) return (bid + ask) / 2;
    return bid ?? ask ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

async function fetchTwelveDataSpot(symbol: string): Promise<number | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return null;
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 6_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { price?: string };
    const n = j.price ? parseFloat(j.price) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export async function getSpotPrice(symbol: string): Promise<number | null> {
  const s = normalize(symbol);
  const oanda = OANDA_MAP[s];
  if (oanda) {
    const p = await fetchOandaSpot(oanda);
    if (p != null) return p;
  }
  return fetchTwelveDataSpot(s);
}
