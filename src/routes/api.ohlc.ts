import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { corsHeadersFor, enforceOrigin, preflight } from "@/lib/api-security";


export type OhlcBar = { time: number; open: number; high: number; low: number; close: number };
export type OhlcSource = "oanda" | "binance" | "twelvedata";
export type OhlcResponse = {
  source: OhlcSource | null;
  bars: OhlcBar[];
  cachedAt: number;
  ttlMs: number;
};

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 8_000, headers?: Record<string, string>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        // Yahoo (and several other free feeds) rate-limit / 403 requests
        // that arrive with the default Worker UA. A browser-ish UA fixes it.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        ...(headers ?? {}),
      },
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

// ----- OANDA v20 (FX, metals, indices - most accurate) -----
const CRYPTO_BASES = new Set([
  "BTC", "ETH", "XRP", "SOL", "DOGE", "ADA", "LTC", "BCH", "LINK", "AVAX",
  "DOT", "MATIC", "TRX", "XLM", "ATOM", "UNI", "ETC", "FIL", "NEAR", "APT",
  "ARB", "OP", "SUI", "TON", "SHIB", "PEPE", "PAXG", "BNB",
]);

/** True for crypto tickers, including ones shaped like an FX pair (ETH/USD). */
function isCryptoTicker(ticker: string): boolean {
  const t = ticker.toUpperCase().replace(/\s+/g, "");
  const base = t.split("/")[0]?.replace(/(USD|USDT)$/, "") ?? "";
  return CRYPTO_BASES.has(t.split("/")[0] ?? "") || CRYPTO_BASES.has(base);
}

function tickerToOanda(ticker: string): string | null {
  const t = ticker.toUpperCase();
  const map: Record<string, string> = {
    "EUR/USD": "EUR_USD",
    "GBP/USD": "GBP_USD",
    "USD/JPY": "USD_JPY",
    "XAU/USD": "XAU_USD",
    "XAG/USD": "XAG_USD",
    "NAS100": "NAS100_USD",
    "SPX500": "SPX500_USD",
    "US30": "US30_USD",
    "US2000": "US2000_USD",
    "GER40": "DE30_EUR",
    "UK100": "UK100_GBP",
    "JPN225": "JP225_USD",
    "WTI OIL": "WTICO_USD",
    "BRENT OIL": "BCO_USD",
    "NATGAS": "NATGAS_USD",
    "XPT/USD": "XPT_USD",
    "XPD/USD": "XPD_USD",
    "AUD/USD": "AUD_USD",
    "NZD/USD": "NZD_USD",
    "USD/CAD": "USD_CAD",
    "USD/CHF": "USD_CHF",
    "EUR/JPY": "EUR_JPY",
    "GBP/JPY": "GBP_JPY",
    "EUR/GBP": "EUR_GBP",
    "AUD/JPY": "AUD_JPY",
    "CAD/JPY": "CAD_JPY",
    "CHF/JPY": "CHF_JPY",
    "EUR/AUD": "EUR_AUD",
    "GBP/AUD": "GBP_AUD",
    "EUR/CHF": "EUR_CHF",
    "USD/SGD": "USD_SGD",
    "USD/MXN": "USD_MXN",
    "USD/ZAR": "USD_ZAR",
  };
  if (map[t]) return map[t];
  // Crypto must never fall through to the FX rule below: "ETH/USD" looks like a
  // 3-letter FX pair, and OANDA's crypto CFDs are stale/unavailable, which put
  // Ethereum hundreds of dollars away from real spot. Crypto uses Binance.
  if (isCryptoTicker(t)) return null;
  // Any plain FX pair OANDA quotes, e.g. "NOK/SEK" -> "NOK_SEK".
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(t)) return t.replace("/", "_");
  return null;
}

function oandaGranularity(interval: string): string {
  switch (interval) {
    case "1": return "M1";
    case "5": return "M5";
    case "15": return "M15";
    case "60": return "H1";
    case "240": return "H4";
    case "D": return "D";
    case "W": return "W";
    case "M": return "M";
    default: return "H1";
  }
}

async function fetchOanda(instrument: string, interval: string): Promise<OhlcBar[]> {
  const { oandaGetJson } = await import("@/lib/oanda-host.server");
  const granularity = oandaGranularity(interval);
  const { json } = await oandaGetJson(
    `/instruments/${instrument}/candles?granularity=${granularity}&count=220&price=M`,
  );
  const candles = (json as {
    candles?: Array<{ time: string; complete?: boolean; mid?: { o: string; h: string; l: string; c: string } }>;
  }).candles;
  if (!candles) throw new Error("OANDA: no candles");
  return cleanBars(
    candles
      .filter((c) => c.mid)
      .map((c) => ({
        time: Math.floor(new Date(c.time).getTime() / 1000),
        open: parseFloat(c.mid!.o),
        high: parseFloat(c.mid!.h),
        low: parseFloat(c.mid!.l),
        close: parseFloat(c.mid!.c),
      })),
  );
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
  // Crypto stays on Binance. "ETH/USD" matches the FX shape below, and the
  // Twelve Data crypto series is a different venue/quote that can sit a few
  // percent away from Binance spot, which made the Ethereum chart jump to a
  // whole new price scale whenever Binance hiccuped for one refresh.
  if (isCryptoTicker(t)) return null;
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

// ----- Binance klines (no key, no quota). Gold trades as PAXG (1 token = 1 oz),
// which tracks XAU/USD spot closely, so it is a real last-resort history feed. -----
function tickerToBinance(ticker: string): string | null {
  const t = ticker.toUpperCase().replace(/\s+/g, "");
  const map: Record<string, string> = {
    "XAU/USD": "PAXGUSDT",
    XAUUSD: "PAXGUSDT",
    GOLD: "PAXGUSDT",
    "BTC/USD": "BTCUSDT",
    "ETH/USD": "ETHUSDT",
    "XRP/USD": "XRPUSDT",
    "SOL/USD": "SOLUSDT",
    "DOGE/USD": "DOGEUSDT",
    "ADA/USD": "ADAUSDT",
    "LINK/USD": "LINKUSDT",
    "AVAX/USD": "AVAXUSDT",
  };
  if (map[t]) return map[t];
  const crypto = t.match(/^([A-Z]{2,6})\/(USD|USDT)$/);
  if (crypto) return `${crypto[1]}USDT`;
  return null;
}

function binanceInterval(interval: string): string {
  return ({ "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", D: "1d", W: "1w", M: "1M" } as Record<string, string>)[interval] ?? "1h";
}

async function fetchBinance(symbol: string, interval: string): Promise<OhlcBar[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval(interval)}&limit=220`;
  const raw = await fetchJsonWithTimeout<Array<[number, string, string, string, string, string]>>(url);
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Binance: no data");
  const bars = raw.map(([ms, o, h, l, c]) => ({
    time: Math.floor(ms / 1000),
    open: parseFloat(o), high: parseFloat(h), low: parseFloat(l), close: parseFloat(c),
  })).filter((b) => Number.isFinite(b.close));
  return cleanBars(bars).slice(-220);
}


// --- Module-level cache (per worker instance). TTL 30s per key. ---
type CacheEntry = { at: number; bars: OhlcBar[]; source: OhlcSource };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30_000;
const INFLIGHT = new Map<string, Promise<CacheEntry>>();

async function fetchBestAvailable(ticker: string, interval: string, prior?: CacheEntry): Promise<CacheEntry> {
  // One consistent feed order everywhere in the app: OANDA (broker-grade,
  // no daily quota) for FX/metals/indices/energy, Binance for crypto and as a
  // gold backstop via PAXG, Twelve Data only as a final safety net.
  const oandaSymbol = tickerToOanda(ticker);
  const binanceSymbol = tickerToBinance(ticker);
  const tdSymbol = tickerToTwelveData(ticker);
  const attempts: Array<() => Promise<CacheEntry>> = [];

  if (oandaSymbol && process.env.OANDA_API_KEY) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchOanda(oandaSymbol, interval), source: "oanda" }));
  }
  if (binanceSymbol) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchBinance(binanceSymbol, interval), source: "binance" }));
  }
  if (tdSymbol) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchTwelveData(tdSymbol, tdInterval(interval)), source: "twelvedata" }));
  }

  // A fallback feed may quote a different venue. If its last price disagrees
  // with the price we were already showing by more than 10%, it is a different
  // market, not a new candle - drop it instead of rescaling the chart.
  const priorLast = prior?.bars.at(-1)?.close;
  const agreesWithPrior = (entry: CacheEntry) => {
    if (!priorLast || entry.source === prior?.source) return true;
    const last = entry.bars.at(-1)?.close;
    if (!last || !Number.isFinite(last)) return false;
    return Math.abs(last - priorLast) / priorLast <= 0.1;
  };

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const entry = await attempt();
      if (entry.bars.length === 0) continue;
      if (!agreesWithPrior(entry)) {
        console.error("[ohlc] rejected off-scale feed", ticker, interval, entry.source, entry.bars.at(-1)?.close, "vs", priorLast);
        continue;
      }
      return entry;
    } catch (error) {
      console.error("[ohlc] attempt failed", ticker, interval, (error as Error)?.message);
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
        if (!tickerToOanda(t) && !tickerToBinance(t) && !tickerToTwelveData(t)) {
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
          inflight = fetchBestAvailable(t, iv, cached)
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
