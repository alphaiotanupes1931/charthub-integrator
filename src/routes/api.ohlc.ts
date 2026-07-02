import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsHeadersFor, enforceOrigin, preflight, rateLimit } from "@/lib/api-security";


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
export type OhlcSource = "coingecko" | "oanda" | "twelvedata" | "yahoo";
export type OhlcResponse = {
  source: OhlcSource | null;
  bars: OhlcBar[];
  cachedAt: number;
  ttlMs: number;
};

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanBars(bars: OhlcBar[]): OhlcBar[] {
  const byTime = new Map<number, OhlcBar>();
  for (const bar of bars) {
    if (
      Number.isFinite(bar.time) &&
      Number.isFinite(bar.open) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close) &&
      bar.high >= bar.low
    ) {
      byTime.set(bar.time, bar);
    }
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

async function fetchCoinGecko(coinId: string, days: number): Promise<OhlcBar[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
  const raw = await fetchJsonWithTimeout<Array<[number, number, number, number, number]>>(url);
  return cleanBars(raw.map(([ms, o, h, l, c]) => ({
    time: Math.floor(ms / 1000),
    open: o,
    high: h,
    low: l,
    close: c,
  })));
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
  // Indices: TwelveData free tier doesn't cover ^NDX/^GSPC/^DJI reliably.
  // Skip TD for indices; Yahoo fallback returns the real index prices.
  return null;
}


async function fetchTwelveData(symbol: string, interval: string): Promise<OhlcBar[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error("TWELVE_DATA_API_KEY not configured");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=220&apikey=${apiKey}&order=ASC&format=JSON`;
  const json = await fetchJsonWithTimeout<{
    status?: string;
    code?: number;
    message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>;
  }>(url);
  if (json.status === "error" || !json.values) {
    throw new Error(`TwelveData: ${json.message ?? "no data"}`);
  }
  return cleanBars(json.values.map((v) => ({
    time: Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000),
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
  })));
}

// ----- Yahoo Finance fallback (no key) -----
function tickerToYahoo(ticker: string): string | null {
  const t = ticker.toUpperCase();
  if (t.includes("BTC")) return "BTC-USD";
  if (t.includes("ETH")) return "ETH-USD";
  if (t.includes("XRP")) return "XRP-USD";
  if (t === "XAU/USD") return "GC=F";
  if (t === "XAG/USD") return "SI=F";
  if (t === "WTI OIL") return "CL=F";
  if (t === "NAS100") return "^NDX";      // Real Nasdaq-100 index (~20,000+), not QQQ ETF (~500)
  if (t === "SPX500") return "^GSPC";     // Real S&P 500 index
  if (t === "US30")   return "^DJI";      // Real Dow Jones index
  if (t === "EUR/USD") return "EURUSD=X";
  if (t === "GBP/USD") return "GBPUSD=X";
  if (t === "USD/JPY") return "JPY=X";
  return null;
}


function yahooInterval(interval: string): { interval: string; range: string } {
  switch (interval) {
    case "1":
      return { interval: "1m", range: "1d" };
    case "5":
      return { interval: "5m", range: "5d" };
    case "15":
      return { interval: "15m", range: "5d" };
    case "60":
      return { interval: "1h", range: "1mo" };
    case "240":
      return { interval: "1h", range: "3mo" };
    case "D":
      return { interval: "1d", range: "6mo" };
    case "W":
      return { interval: "1wk", range: "2y" };
    case "M":
      return { interval: "1mo", range: "5y" };
    default:
      return { interval: "1h", range: "1mo" };
  }
}

async function fetchYahoo(symbol: string, interval: string): Promise<OhlcBar[]> {
  const iv = yahooInterval(interval);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${iv.interval}&range=${iv.range}&includePrePost=true`;
  const json = await fetchJsonWithTimeout<{
    chart?: {
      error?: { description?: string } | null;
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> };
      }>;
    };
  }>(url);
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (json.chart?.error || !result?.timestamp || !quote) {
    throw new Error(`Yahoo: ${json.chart?.error?.description ?? "no data"}`);
  }
  const bars = result.timestamp.map((time, i) => {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (open == null || high == null || low == null || close == null) return null;
    return { time, open, high, low, close } satisfies OhlcBar;
  }).filter((bar): bar is OhlcBar => bar !== null);
  return cleanBars(bars).slice(-220);
}

// --- Module-level cache (per worker instance). TTL 30s per key. ---
type CacheEntry = { at: number; bars: OhlcBar[]; source: OhlcSource };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30_000;
const INFLIGHT = new Map<string, Promise<CacheEntry>>();

async function fetchBestAvailable(ticker: string, interval: string): Promise<CacheEntry> {
  const coin = tickerToCoin(ticker);
  const tdSymbol = coin ? null : tickerToTwelveData(ticker);
  const yahooSymbol = tickerToYahoo(ticker);
  const attempts: Array<() => Promise<CacheEntry>> = [];

  if (coin) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchCoinGecko(coin, daysForInterval(interval)), source: "coingecko" }));
  }
  if (tdSymbol) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchTwelveData(tdSymbol, tdInterval(interval)), source: "twelvedata" }));
  }
  if (yahooSymbol) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchYahoo(yahooSymbol, interval), source: "yahoo" }));
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const entry = await attempt();
      if (entry.bars.length > 0) return entry;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No OHLC source available");
}

export const Route = createFileRoute("/api/ohlc")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request) ?? new Response(null, { status: 204 }),
      GET: async ({ request }) => {
        const originBlock = enforceOrigin(request);
        if (originBlock) return originBlock;
        const limited = rateLimit(request, { key: "ohlc", limit: 120, windowMs: 60_000 });
        if (limited) return limited;
        const cors = corsHeadersFor(request);
        const jsonHeaders = { "content-type": "application/json", ...cors };
        const url = new URL(request.url);
        const ticker = url.searchParams.get("ticker");
        const interval = url.searchParams.get("interval");
        if (!ticker || !interval) {
          return new Response(JSON.stringify({ error: "ticker and interval required" }), {
            status: 400,
            headers: jsonHeaders,
          });
        }
        const parsed = z.object({ ticker: z.string(), interval: z.string() }).safeParse({ ticker, interval });
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid ticker or interval" }), {
            status: 400,
            headers: jsonHeaders,
          });
        }

        const { ticker: t, interval: iv } = parsed.data;
        if (!tickerToCoin(t) && !tickerToTwelveData(t) && !tickerToYahoo(t)) {
          return new Response(JSON.stringify({ source: null, bars: [], cachedAt: Date.now(), ttlMs: 0 }), {
            headers: jsonHeaders,
          });
        }

        const key = `ohlc:${t.toUpperCase()}:${iv}`;

        const now = Date.now();
        const cached = CACHE.get(key);
        if (cached && now - cached.at < TTL_MS) {
          return new Response(JSON.stringify({ source: cached.source, bars: cached.bars, cachedAt: cached.at, ttlMs: TTL_MS }), {
            headers: jsonHeaders,
          });
        }

        let inflight = INFLIGHT.get(key);
        if (!inflight) {
          inflight = fetchBestAvailable(t, iv)
            .then((entry) => {
              CACHE.set(key, entry);
              return entry;
            })
            .finally(() => INFLIGHT.delete(key));
          INFLIGHT.set(key, inflight);
        }

        try {
          const entry = await inflight;
          return new Response(JSON.stringify({ source: entry.source, bars: entry.bars, cachedAt: entry.at, ttlMs: TTL_MS }), {
            headers: jsonHeaders,
          });
        } catch {
          if (cached) {
            return new Response(JSON.stringify({ source: cached.source, bars: cached.bars, cachedAt: cached.at, ttlMs: TTL_MS }), {
              headers: jsonHeaders,
            });
          }
          return new Response(JSON.stringify({ source: null, bars: [], cachedAt: Date.now(), ttlMs: 0 }), {
            headers: jsonHeaders,
          });
        }
      },
    },
  },
});
