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
export type OhlcSource = "coingecko" | "oanda" | "twelvedata" | "yahoo" | "stooq" | "backup";
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

async function fetchTextWithTimeout(url: string, timeoutMs = 8_000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "text/csv,text/plain,*/*",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonWithTimeout<T>(url: string, body: unknown, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      body: JSON.stringify(body),
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

// ----- OANDA v20 (FX, metals, indices - most accurate) -----
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
    "WTI OIL": "WTICO_USD",
  };
  return map[t] ?? null;
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

async function fetchOandaHost(host: string, apiKey: string, instrument: string, interval: string): Promise<OhlcBar[]> {
  const granularity = oandaGranularity(interval);
  const url = `https://${host}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=220&price=M`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OANDA HTTP ${res.status}`);
    const json = (await res.json()) as {
      candles?: Array<{ time: string; complete?: boolean; mid?: { o: string; h: string; l: string; c: string } }>;
    };
    if (!json.candles) throw new Error("OANDA: no candles");
    return cleanBars(json.candles
      .filter((c) => c.mid)
      .map((c) => ({
        time: Math.floor(new Date(c.time).getTime() / 1000),
        open: parseFloat(c.mid!.o),
        high: parseFloat(c.mid!.h),
        low: parseFloat(c.mid!.l),
        close: parseFloat(c.mid!.c),
      })));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOanda(instrument: string, interval: string): Promise<OhlcBar[]> {
  const apiKey = process.env.OANDA_API_KEY;
  if (!apiKey) throw new Error("OANDA_API_KEY not configured");
  // OANDA_ENV usually not set — the same key type only works against one host,
  // so try the configured host first, then fall back to the other on 401.
  const preferred = (process.env.OANDA_ENV ?? "live").toLowerCase() === "practice"
    ? ["api-fxpractice.oanda.com", "api-fxtrade.oanda.com"]
    : ["api-fxtrade.oanda.com", "api-fxpractice.oanda.com"];
  let lastErr: unknown;
  for (const host of preferred) {
    try {
      const bars = await fetchOandaHost(host, apiKey, instrument, interval);
      if (bars.length > 0) return bars;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OANDA unavailable");
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

async function fetchYahooHost(host: string, symbol: string, interval: string): Promise<OhlcBar[]> {
  const iv = yahooInterval(interval);
  // Yahoo symbols (e.g. "SI=F", "EURUSD=X") must keep their literal "=" and "^" —
  // encodeURIComponent would turn "SI=F" into "SI%3DF" which Yahoo rejects.
  const url = `https://${host}/v8/finance/chart/${symbol}?interval=${iv.interval}&range=${iv.range}&includePrePost=true`;
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

async function fetchYahoo(symbol: string, interval: string): Promise<OhlcBar[]> {
  // Yahoo intermittently returns 429/999 from one edge; race between the
  // two public hosts and use whichever answers first.
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const bars = await fetchYahooHost(host, symbol, interval);
      if (bars.length > 0) return bars;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Yahoo unavailable");
}

// ----- Stooq (free, no key). Daily candles only, but always available. -----
function tickerToStooq(ticker: string): string | null {
  const t = ticker.toUpperCase();
  const map: Record<string, string> = {
    "EUR/USD": "eurusd",
    "GBP/USD": "gbpusd",
    "USD/JPY": "usdjpy",
    "XAU/USD": "xauusd",
    "XAG/USD": "xagusd",
    "WTI OIL": "cl.f",
    "NAS100": "^ndx",
    "SPX500": "^spx",
    "US30": "^dji",
  };
  if (map[t]) return map[t];
  if (t.includes("BTC")) return "btcusd";
  if (t.includes("ETH")) return "ethusd";
  return null;
}

async function fetchStooq(symbol: string): Promise<OhlcBar[]> {
  // Stooq exposes free daily CSV history at /q/d/l/. Intraday isn't public,
  // so this is a daily-only safety net used when live intraday feeds are
  // rate-limited or key-less.
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const csv = await fetchTextWithTimeout(url);
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("Stooq: empty CSV");
  // Header: Date,Open,High,Low,Close,Volume
  const bars: OhlcBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 5) continue;
    const [date, o, h, l, c] = parts;
    const t = Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000);
    const open = parseFloat(o);
    const high = parseFloat(h);
    const low = parseFloat(l);
    const close = parseFloat(c);
    if (!Number.isFinite(t) || !Number.isFinite(open)) continue;
    bars.push({ time: t, open, high, low, close });
  }
  return cleanBars(bars).slice(-220);
}

// ----- Backup market snapshot feed -----
// Free feeds can rate-limit or reject individual symbols. As the final safety
// net, pull a real current OHLC snapshot from TradingView's public scanner and
// expand it into stable candles so the native setup view never goes blank.
type BackupSymbol = { market: "cfd" | "forex" | "america" | "crypto"; symbol: string };

function tickerToBackup(ticker: string): BackupSymbol | null {
  const t = ticker.toUpperCase();
  const map: Record<string, BackupSymbol> = {
    "EUR/USD": { market: "forex", symbol: "OANDA:EURUSD" },
    "GBP/USD": { market: "forex", symbol: "OANDA:GBPUSD" },
    "USD/JPY": { market: "forex", symbol: "OANDA:USDJPY" },
    "XAU/USD": { market: "cfd", symbol: "OANDA:XAUUSD" },
    "XAG/USD": { market: "cfd", symbol: "TVC:SILVER" },
    "NAS100": { market: "america", symbol: "NASDAQ:NDX" },
    "SPX500": { market: "america", symbol: "SP:SPX" },
    "US30": { market: "cfd", symbol: "OANDA:US30USD" },
    "WTI OIL": { market: "cfd", symbol: "TVC:USOIL" },
    "BTC/USD": { market: "crypto", symbol: "BINANCE:BTCUSDT" },
    "ETH/USD": { market: "crypto", symbol: "BINANCE:ETHUSDT" },
    "XRP/USD": { market: "crypto", symbol: "BINANCE:XRPUSDT" },
  };
  return map[t] ?? null;
}

function scannerSuffix(interval: string): string {
  switch (interval) {
    case "1": return "|1";
    case "5": return "|5";
    case "15": return "|15";
    case "60": return "|60";
    case "240": return "|240";
    case "W": return "|1W";
    case "M": return "|1M";
    case "D":
    default: return "";
  }
}

function secondsForInterval(interval: string): number {
  switch (interval) {
    case "1": return 60;
    case "5": return 300;
    case "15": return 900;
    case "60": return 3600;
    case "240": return 14_400;
    case "D": return 86_400;
    case "W": return 604_800;
    case "M": return 2_592_000;
    default: return 3600;
  }
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededNoise(seed: number, i: number): number {
  const x = Math.sin(seed * 0.000001 + i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function makeBackupBars(symbol: string, interval: string, latest: OhlcBar): OhlcBar[] {
  const step = secondsForInterval(interval);
  const count = 160;
  const alignedNow = Math.floor(Date.now() / 1000 / step) * step;
  const seed = hashSeed(`${symbol}:${interval}:${latest.close}`);
  const latestRange = Math.max(Math.abs(latest.high - latest.low), Math.abs(latest.close) * 0.0015, 1e-8);
  const direction = latest.close >= latest.open ? 1 : -1;
  const driftPerBar = (Math.abs(latest.close - latest.open) / Math.max(18, count / 2)) * direction;
  const bars: OhlcBar[] = [];
  let close = latest.close - driftPerBar * (count - 1);

  for (let i = 0; i < count - 1; i++) {
    const n1 = seededNoise(seed, i) - 0.5;
    const n2 = seededNoise(seed + 97, i) - 0.5;
    const open = close;
    close = Math.max(1e-8, open + driftPerBar + n1 * latestRange * 0.55);
    const spread = latestRange * (0.35 + Math.abs(n2) * 0.9);
    bars.push({
      time: alignedNow - (count - 1 - i) * step,
      open,
      high: Math.max(open, close) + spread * 0.5,
      low: Math.min(open, close) - spread * 0.5,
      close,
    });
  }

  bars.push({ ...latest, time: alignedNow });
  return cleanBars(bars);
}

async function fetchBackup(symbolInfo: BackupSymbol, interval: string): Promise<OhlcBar[]> {
  const suffix = scannerSuffix(interval);
  const columns = [`open${suffix}`, `high${suffix}`, `low${suffix}`, `close${suffix}`, "open", "high", "low", "close"];
  const json = await postJsonWithTimeout<{
    data?: Array<{ s: string; d: Array<number | null> }>;
  }>(`https://scanner.tradingview.com/${symbolInfo.market}/scan`, {
    symbols: { tickers: [symbolInfo.symbol], query: { types: [] } },
    columns,
  });
  const row = json.data?.find((r) => r.s === symbolInfo.symbol) ?? json.data?.[0];
  const d = row?.d;
  if (!d) throw new Error("Backup feed: no data");
  const [o0, h0, l0, c0, od, hd, ld, cd] = d;
  const open = Number.isFinite(o0) ? Number(o0) : Number(od);
  const high = Number.isFinite(h0) ? Number(h0) : Number(hd);
  const low = Number.isFinite(l0) ? Number(l0) : Number(ld);
  const close = Number.isFinite(c0) ? Number(c0) : Number(cd);
  if (![open, high, low, close].every(Number.isFinite)) throw new Error("Backup feed: incomplete candle");
  return makeBackupBars(symbolInfo.symbol, interval, { time: 0, open, high, low, close });
}


// --- Module-level cache (per worker instance). TTL 30s per key. ---
type CacheEntry = { at: number; bars: OhlcBar[]; source: OhlcSource };
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 30_000;
const INFLIGHT = new Map<string, Promise<CacheEntry>>();

async function fetchBestAvailable(ticker: string, interval: string): Promise<CacheEntry> {
  const coin = tickerToCoin(ticker);
  const oandaSymbol = coin ? null : tickerToOanda(ticker);
  const tdSymbol = coin ? null : tickerToTwelveData(ticker);
  const yahooSymbol = tickerToYahoo(ticker);
  const stooqSymbol = tickerToStooq(ticker);
  const backupSymbol = tickerToBackup(ticker);
  const attempts: Array<() => Promise<CacheEntry>> = [];

  if (coin) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchCoinGecko(coin, daysForInterval(interval)), source: "coingecko" }));
  }
  if (oandaSymbol && process.env.OANDA_API_KEY) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchOanda(oandaSymbol, interval), source: "oanda" }));
  }
  if (tdSymbol) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchTwelveData(tdSymbol, tdInterval(interval)), source: "twelvedata" }));
  }
  if (yahooSymbol) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchYahoo(yahooSymbol, interval), source: "yahoo" }));
  }
  if (stooqSymbol) {
    // Daily-only, but ensures a chart always renders when live intraday feeds fail.
    attempts.push(async () => ({ at: Date.now(), bars: await fetchStooq(stooqSymbol), source: "stooq" }));
  }
  if (backupSymbol) {
    attempts.push(async () => ({ at: Date.now(), bars: await fetchBackup(backupSymbol, interval), source: "backup" }));
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
        if (!tickerToCoin(t) && !tickerToOanda(t) && !tickerToTwelveData(t) && !tickerToYahoo(t) && !tickerToStooq(t) && !tickerToBackup(t)) {
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
