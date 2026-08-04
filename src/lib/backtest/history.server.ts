// Long-range historical bars for the backtester.
//
// The chart route only needs the last ~220 candles; a backtest needs years, so
// this walks a provider chain and returns the first series that comes back with
// enough bars:
//
//   1. OANDA v3 candles  - FX, metals, indices, oil (native M15/H1/H4/D)
//   2. Twelve Data       - FX, metals, oil, crypto
//   3. Binance klines    - crypto, no key needed, paginated
//   4. Yahoo chart       - everything, but rate limits hard
//
// 4H is aggregated from 1H whenever a provider has no native 4H series.

import type { BtBar } from "./engine";
import type { BacktestTimeframe } from "./catalog";

const OANDA_INSTRUMENT: Record<string, string> = {
  "XAU/USD": "XAU_USD",
  "XAG/USD": "XAG_USD",
  NAS100: "NAS100_USD",
  SPX500: "SPX500_USD",
  US30: "US30_USD",
  "WTI Oil": "WTICO_USD",
  "EUR/USD": "EUR_USD",
  "GBP/USD": "GBP_USD",
  "USD/JPY": "USD_JPY",
  "BTC/USD": "BTC_USD",
};

const TWELVE_SYMBOL: Record<string, string> = {
  "XAU/USD": "XAU/USD",
  "XAG/USD": "XAG/USD",
  "WTI Oil": "WTI/USD",
  "EUR/USD": "EUR/USD",
  "GBP/USD": "GBP/USD",
  "USD/JPY": "USD/JPY",
  "BTC/USD": "BTC/USD",
  "ETH/USD": "ETH/USD",
  "XRP/USD": "XRP/USD",
};

const BINANCE_SYMBOL: Record<string, string> = {
  "BTC/USD": "BTCUSDT",
  "ETH/USD": "ETHUSDT",
  "XRP/USD": "XRPUSDT",
};

const YAHOO_SYMBOL: Record<string, string> = {
  "XAU/USD": "GC=F",
  "XAG/USD": "SI=F",
  NAS100: "^NDX",
  SPX500: "^GSPC",
  US30: "^DJI",
  "WTI Oil": "CL=F",
  "EUR/USD": "EURUSD=X",
  "GBP/USD": "GBPUSD=X",
  "USD/JPY": "USDJPY=X",
  "BTC/USD": "BTC-USD",
  "ETH/USD": "ETH-USD",
  "XRP/USD": "XRP-USD",
};

const MIN_BARS = 120;

/** Roughly how many bars the requested lookback covers, capped per provider. */
function wantedBars(tf: BacktestTimeframe, lookback: string): number {
  const days = lookback === "60d" ? 60 : lookback === "1y" ? 365 : lookback === "5y" ? 1825 : 730;
  const perDay = tf === "15" ? 96 : tf === "60" ? 24 : tf === "240" ? 6 : 1;
  return Math.min(5000, Math.max(MIN_BARS, Math.round(days * perDay * 0.72)));
}

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function sortDedupe(bars: BtBar[]): BtBar[] {
  const map = new Map<number, BtBar>();
  for (const b of bars) {
    if (![b.open, b.high, b.low, b.close].every(Number.isFinite)) continue;
    map.set(b.time, b);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** Aggregate 1H bars into 4H buckets aligned to 00:00 UTC. */
function to4h(bars: BtBar[]): BtBar[] {
  const out: BtBar[] = [];
  let current: BtBar | null = null;
  let bucket = -1;
  for (const b of bars) {
    const key = Math.floor(b.time / 14_400);
    if (!current || key !== bucket) {
      if (current) out.push(current);
      current = { ...b, volume: b.volume ?? 0 };
      bucket = key;
      continue;
    }
    current.high = Math.max(current.high, b.high);
    current.low = Math.min(current.low, b.low);
    current.close = b.close;
    current.volume = (current.volume ?? 0) + (b.volume ?? 0);
  }
  if (current) out.push(current);
  return out;
}

// ---------------------------------------------------------------- OANDA

function oandaGranularity(tf: BacktestTimeframe): string {
  return tf === "15" ? "M15" : tf === "60" ? "H1" : tf === "240" ? "H4" : "D";
}

async function fromOanda(symbol: string, tf: BacktestTimeframe, lookback: string): Promise<BtBar[]> {
  const instrument = OANDA_INSTRUMENT[symbol];
  const apiKey = process.env.OANDA_API_KEY;
  if (!instrument || !apiKey) throw new Error("oanda not configured");
  const env = (process.env.OANDA_ENV ?? "live").toLowerCase();
  const host = env === "practice" ? "api-fxpractice.oanda.com" : "api-fxtrade.oanda.com";
  const count = wantedBars(tf, lookback);
  const url = `https://${host}/v3/instruments/${instrument}/candles?granularity=${oandaGranularity(tf)}&count=${count}&price=M`;
  const json = await getJson<{
    candles?: Array<{
      time: string;
      complete?: boolean;
      volume?: number;
      mid?: { o: string; h: string; l: string; c: string };
    }>;
  }>(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  const bars = (json.candles ?? [])
    .filter((c) => c.complete !== false && c.mid)
    .map((c) => ({
      time: Math.floor(new Date(c.time).getTime() / 1000),
      open: Number(c.mid!.o),
      high: Number(c.mid!.h),
      low: Number(c.mid!.l),
      close: Number(c.mid!.c),
      volume: c.volume,
    }));
  return sortDedupe(bars);
}

// ----------------------------------------------------------- Twelve Data

function twelveInterval(tf: BacktestTimeframe): string {
  return tf === "15" ? "15min" : tf === "60" ? "1h" : tf === "240" ? "4h" : "1day";
}

async function fromTwelveData(symbol: string, tf: BacktestTimeframe, lookback: string): Promise<BtBar[]> {
  const sym = TWELVE_SYMBOL[symbol];
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!sym || !key) throw new Error("twelvedata not configured");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${twelveInterval(tf)}&outputsize=${wantedBars(tf, lookback)}&order=ASC&apikey=${key}`;
  const json = await getJson<{
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
    message?: string;
  }>(url);
  if (!json.values?.length) throw new Error(json.message ?? "twelvedata empty");
  return sortDedupe(
    json.values.map((v) => ({
      time: Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: v.volume == null ? undefined : Number(v.volume),
    })),
  );
}

// -------------------------------------------------------------- Binance

function binanceInterval(tf: BacktestTimeframe): string {
  return tf === "15" ? "15m" : tf === "60" ? "1h" : tf === "240" ? "4h" : "1d";
}

async function fromBinance(symbol: string, tf: BacktestTimeframe, lookback: string): Promise<BtBar[]> {
  const sym = BINANCE_SYMBOL[symbol];
  if (!sym) throw new Error("binance has no mapping");
  const want = wantedBars(tf, lookback);
  const interval = binanceInterval(tf);
  const out: BtBar[] = [];
  let endTime: number | undefined;
  for (let page = 0; page < 6 && out.length < want; page++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=1000${endTime ? `&endTime=${endTime}` : ""}`;
    const rows = await getJson<Array<[number, string, string, string, string, string, ...unknown[]]>>(url);
    if (!rows.length) break;
    for (const r of rows) {
      out.push({
        time: Math.floor(r[0] / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      });
    }
    endTime = rows[0][0] - 1;
  }
  return sortDedupe(out);
}

// ---------------------------------------------------------------- Yahoo

function yahooRequest(tf: BacktestTimeframe, lookback: string): { interval: string; range: string } {
  if (tf === "15") return { interval: "15m", range: "60d" };
  if (tf === "60" || tf === "240") return { interval: "1h", range: "730d" };
  return { interval: "1d", range: lookback === "1y" ? "1y" : lookback === "2y" ? "2y" : "5y" };
}

type YahooChart = {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
    error?: { description?: string } | null;
  };
};

async function fromYahoo(symbol: string, tf: BacktestTimeframe, lookback: string): Promise<BtBar[]> {
  const mapped = YAHOO_SYMBOL[symbol];
  if (!mapped) throw new Error("yahoo has no mapping");
  const { interval, range } = yahooRequest(tf, lookback);
  let lastError = "";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(mapped)}?interval=${interval}&range=${range}&includePrePost=false`;
    try {
      const json = await getJson<YahooChart>(url, {
        headers: {
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
      });
      const result = json.chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      const stamps = result?.timestamp ?? [];
      if (!quote || stamps.length === 0) {
        lastError = json.chart?.error?.description ?? "empty series";
        continue;
      }
      const bars: BtBar[] = [];
      for (let i = 0; i < stamps.length; i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        const v = quote.volume?.[i];
        bars.push({ time: stamps[i], open: o, high: h, low: l, close: c, volume: v == null ? undefined : v });
      }
      const clean = sortDedupe(bars);
      if (clean.length > 0) return clean;
      lastError = "no usable bars";
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  throw new Error(lastError || "yahoo unavailable");
}

// ---------------------------------------------------------------- chain

type Provider = {
  name: string;
  native4h: boolean;
  load: (symbol: string, tf: BacktestTimeframe, lookback: string) => Promise<BtBar[]>;
};

const PROVIDERS: Provider[] = [
  { name: "oanda", native4h: true, load: fromOanda },
  { name: "twelvedata", native4h: true, load: fromTwelveData },
  { name: "binance", native4h: true, load: fromBinance },
  { name: "yahoo", native4h: false, load: fromYahoo },
];

export async function getHistory(
  symbol: string,
  timeframe: BacktestTimeframe,
  lookback: string,
): Promise<{ bars: BtBar[]; source: string }> {
  const failures: string[] = [];
  for (const provider of PROVIDERS) {
    const requestTf: BacktestTimeframe = timeframe === "240" && !provider.native4h ? "60" : timeframe;
    try {
      const raw = await provider.load(symbol, requestTf, lookback);
      const bars = timeframe === "240" && !provider.native4h ? to4h(raw) : raw;
      if (bars.length < MIN_BARS) {
        failures.push(`${provider.name}: only ${bars.length} bars`);
        continue;
      }
      return { bars, source: `${provider.name}:${timeframe}/${lookback}` };
    } catch (e) {
      failures.push(`${provider.name}: ${(e as Error).message}`);
    }
  }
  throw new Error(`Historical data unavailable for ${symbol} (${failures.join("; ")})`);
}
