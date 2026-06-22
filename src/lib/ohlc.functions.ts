import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// CoinGecko OHLC granularity (free tier, no key):
//   days 1   -> 30m candles
//   days 7   -> 4h candles
//   days 14  -> 4h candles
//   days 30  -> 4h candles
//   days 90+ -> 4d candles
const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
};

// Map our chart intervals to a "days" window that gives a useful candle count.
function daysForInterval(interval: string): number {
  switch (interval) {
    case "1":
    case "5":
    case "15":
      return 1; // 30m candles — coarse but real
    case "60":
    case "240":
      return 14; // 4h candles
    case "D":
      return 90; // 4d candles
    case "W":
    case "M":
      return 365; // 4d candles
    default:
      return 14;
  }
}

export type OhlcBar = { time: number; open: number; high: number; low: number; close: number };
export type OhlcResponse = {
  source: "coingecko" | "synthetic";
  bars: OhlcBar[];
  cachedAt: number;
  ttlMs: number;
};

// --- Module-level cache (per worker instance). TTL 30s per (coin, days). ---
type CacheEntry = { at: number; bars: OhlcBar[] };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30_000;
// In-flight dedupe so 20 concurrent users = 1 upstream call.
const INFLIGHT = new Map<string, Promise<OhlcBar[]>>();

async function fetchCoinGecko(coinId: string, days: number): Promise<OhlcBar[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const raw = (await res.json()) as Array<[number, number, number, number, number]>;
  return raw.map(([ms, o, h, l, c]) => ({
    time: Math.floor(ms / 1000),
    open: o,
    high: h,
    low: l,
    close: c,
  }));
}

function tickerToCoin(ticker: string): string | null {
  const t = ticker.toUpperCase();
  if (t.includes("BTC")) return COIN_IDS.BTC;
  if (t.includes("ETH")) return COIN_IDS.ETH;
  return null;
}

export const getOhlc = createServerFn({ method: "GET" })
  .inputValidator((input: { ticker: string; interval: string }) =>
    z.object({ ticker: z.string(), interval: z.string() }).parse(input),
  )
  .handler(async ({ data }): Promise<OhlcResponse> => {
    const coin = tickerToCoin(data.ticker);
    if (!coin) {
      // Non-crypto symbols (XAU, FX, indices) aren't on CoinGecko free OHLC.
      // Client falls back to its synthetic generator.
      return { source: "synthetic", bars: [], cachedAt: Date.now(), ttlMs: 0 };
    }
    const days = daysForInterval(data.interval);
    const key = `${coin}:${days}`;

    const cached = CACHE.get(key);
    const now = Date.now();
    if (cached && now - cached.at < TTL_MS) {
      return { source: "coingecko", bars: cached.bars, cachedAt: cached.at, ttlMs: TTL_MS };
    }

    let inflight = INFLIGHT.get(key);
    if (!inflight) {
      inflight = fetchCoinGecko(coin, days)
        .then((bars) => {
          CACHE.set(key, { at: Date.now(), bars });
          return bars;
        })
        .finally(() => INFLIGHT.delete(key));
      INFLIGHT.set(key, inflight);
    }

    try {
      const bars = await inflight;
      return { source: "coingecko", bars, cachedAt: Date.now(), ttlMs: TTL_MS };
    } catch {
      // Upstream failure → serve stale cache if we have any, else synthetic fallback.
      if (cached) {
        return { source: "coingecko", bars: cached.bars, cachedAt: cached.at, ttlMs: TTL_MS };
      }
      return { source: "synthetic", bars: [], cachedAt: Date.now(), ttlMs: 0 };
    }
  });
