import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// ----- CoinGecko (crypto, no key) -----
const COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
};

function daysForInterval(interval: string): number {
  switch (interval) {
    case "1":
    case "5":
    case "15":
      return 1;
    case "60":
    case "240":
      return 14;
    case "D":
      return 90;
    case "W":
    case "M":
      return 365;
    default:
      return 14;
  }
}

export type OhlcBar = { time: number; open: number; high: number; low: number; close: number };
export type OhlcSource = "coingecko" | "twelvedata";
export type OhlcResponse = {
  source: OhlcSource | null;
  bars: OhlcBar[];
  cachedAt: number;
  ttlMs: number;
};

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

// ----- Twelve Data (FX, metals, indices) -----
function tdInterval(interval: string): string {
  switch (interval) {
    case "1":
      return "1min";
    case "5":
      return "5min";
    case "15":
      return "15min";
    case "60":
      return "1h";
    case "240":
      return "4h";
    case "D":
      return "1day";
    case "W":
      return "1week";
    case "M":
      return "1month";
    default:
      return "1h";
  }
}

function tickerToTwelveData(ticker: string): string | null {
  const t = ticker.toUpperCase();
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(t)) return t;
  if (t === "NAS100") return "QQQ";
  if (t === "SPX500") return "SPY";
  if (t === "US30") return "DIA";
  return null;
}

async function fetchTwelveData(symbol: string, interval: string): Promise<OhlcBar[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY not configured");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=220&apikey=${apiKey}&order=ASC&format=JSON`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`TwelveData ${res.status}`);
  const json = (await res.json()) as {
    status?: string;
    code?: number;
    message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>;
  };
  if (json.status === "error" || !json.values) {
    throw new Error(`TwelveData: ${json.message ?? "no data"}`);
  }
  return json.values.map((v) => ({
    time: Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  }));
}

// --- Module-level cache (per worker instance). TTL 30s per key. ---
type CacheEntry = { at: number; bars: OhlcBar[]; source: OhlcSource };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30_000;
const INFLIGHT = new Map<string, Promise<CacheEntry>>();

export const Route = createFileRoute("/api/ohlc")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const ticker = url.searchParams.get("ticker");
        const interval = url.searchParams.get("interval");
        if (!ticker || !interval) {
          return new Response(JSON.stringify({ error: "ticker and interval required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const parsed = z.object({ ticker: z.string(), interval: z.string() }).safeParse({ ticker, interval });
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid ticker or interval" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const { ticker: t, interval: iv } = parsed.data;
        const coin = tickerToCoin(t);
        const tdSymbol = coin ? null : tickerToTwelveData(t);

        let key: string;
        let fetcher: () => Promise<OhlcBar[]>;
        let source: OhlcSource;

        if (coin) {
          const days = daysForInterval(iv);
          key = `cg:${coin}:${days}`;
          source = "coingecko";
          fetcher = () => fetchCoinGecko(coin, days);
        } else if (tdSymbol) {
          const tdIv = tdInterval(iv);
          key = `td:${tdSymbol}:${tdIv}`;
          source = "twelvedata";
          fetcher = () => fetchTwelveData(tdSymbol, tdIv);
        } else {
          return new Response(JSON.stringify({ source: null, bars: [], cachedAt: Date.now(), ttlMs: 0 }), {
            headers: { "content-type": "application/json" },
          });
        }

        const now = Date.now();
        const cached = CACHE.get(key);
        if (cached && now - cached.at < TTL_MS) {
          return new Response(JSON.stringify({ source: cached.source, bars: cached.bars, cachedAt: cached.at, ttlMs: TTL_MS }), {
            headers: { "content-type": "application/json" },
          });
        }

        let inflight = INFLIGHT.get(key);
        if (!inflight) {
          inflight = fetcher()
            .then((bars) => {
              const entry: CacheEntry = { at: Date.now(), bars, source };
              CACHE.set(key, entry);
              return entry;
            })
            .finally(() => INFLIGHT.delete(key));
          INFLIGHT.set(key, inflight);
        }

        try {
          const entry = await inflight;
          return new Response(JSON.stringify({ source: entry.source, bars: entry.bars, cachedAt: entry.at, ttlMs: TTL_MS }), {
            headers: { "content-type": "application/json" },
          });
        } catch {
          if (cached) {
            return new Response(JSON.stringify({ source: cached.source, bars: cached.bars, cachedAt: cached.at, ttlMs: TTL_MS }), {
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ source: null, bars: [], cachedAt: Date.now(), ttlMs: 0 }), {
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
