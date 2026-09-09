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

// Journal rows carry whatever the trader typed or a screenshot produced:
// "EURAUD", "Pound / Dollar (GBP/USD)", "xauusd". Without normalising these the
// monitor cannot find price history and the trade stays open at 0.00 forever.
const CURRENCIES = new Set([
  "AUD", "CAD", "CHF", "CNH", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF", "JPY", "MXN",
  "NOK", "NZD", "PLN", "SEK", "SGD", "THB", "TRY", "USD", "ZAR", "XAU", "XAG", "XPT", "XPD",
]);

const INDEX_ALIAS: Record<string, string> = {
  NAS100: "NAS100_USD", NDX: "NAS100_USD", US100: "NAS100_USD",
  SPX500: "SPX500_USD", SPX: "SPX500_USD", US500: "SPX500_USD",
  US30: "US30_USD", DJI: "US30_USD",
  GER40: "DE30_EUR", UK100: "UK100_GBP", JP225: "JP225_USD",
  WTIOIL: "WTICO_USD", WTI: "WTICO_USD", OIL: "WTICO_USD", USOIL: "WTICO_USD",
  NATGAS: "NATGAS_USD", GOLD: "XAU_USD", SILVER: "XAG_USD",
};

/** Best-effort symbol -> OANDA instrument, for anything not in the table above. */
export function normalizeOandaInstrument(symbol: string): string | null {
  const direct = OANDA_INSTRUMENT[symbol];
  if (direct) return direct;
  const raw = String(symbol || "");
  // A display name like "Pound / Dollar (GBP/USD)" carries the real pair in brackets.
  const bracket = raw.match(/\(([^)]+)\)/);
  const core = (bracket ? bracket[1]! : raw).toUpperCase();
  const mapped = OANDA_INSTRUMENT[core] ?? OANDA_INSTRUMENT[core.replace(/\s+/g, "")];
  if (mapped) return mapped;
  const compact = core.replace(/[^A-Z0-9]/g, "");
  if (INDEX_ALIAS[compact]) return INDEX_ALIAS[compact]!;
  if (compact.length === 6) {
    const base = compact.slice(0, 3);
    const quote = compact.slice(3);
    if (CURRENCIES.has(base) && CURRENCIES.has(quote)) return `${base}_${quote}`;
  }
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(compact.replace(/(\w{3})(\w{3})/, "$1_$2"))) return null;
  return null;
}

/** Same idea for TwelveData, which wants "EUR/AUD". */
function normalizeTwelveSymbol(symbol: string): string | null {
  const direct = TWELVE_SYMBOL[symbol];
  if (direct) return direct;
  const inst = normalizeOandaInstrument(symbol);
  if (inst && /^[A-Z]{3}_[A-Z]{3}$/.test(inst)) return inst.replace("_", "/");
  return null;
}

const BINANCE_SYMBOL: Record<string, string> = {
  "BTC/USD": "BTCUSDT",
  "ETH/USD": "ETHUSDT",
  "XRP/USD": "XRPUSDT",
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
  const instrument = normalizeOandaInstrument(symbol);
  const apiKey = process.env.OANDA_API_KEY;
  if (!instrument || !apiKey) throw new Error("oanda not configured");
  const count = wantedBars(tf, lookback);
  // Host is resolved by which one accepts the token, not by OANDA_ENV.
  const { oandaGetJson } = await import("@/lib/oanda-host.server");
  const { json } = await oandaGetJson(
    `/instruments/${instrument}/candles?granularity=${oandaGranularity(tf)}&count=${count}&price=M`,
    15_000,
  );
  const bars = ((json as {
    candles?: Array<{
      time: string;
      complete?: boolean;
      volume?: number;
      mid?: { o: string; h: string; l: string; c: string };
    }>;
  }).candles ?? [])
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
  const sym = normalizeTwelveSymbol(symbol);
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

type Provider = {
  name: string;
  native4h: boolean;
  load: (symbol: string, tf: BacktestTimeframe, lookback: string) => Promise<BtBar[]>;
};

// Same order as the charts and the scanner: one feed story across the app.
const PROVIDERS: Provider[] = [
  { name: "oanda", native4h: true, load: fromOanda },
  { name: "binance", native4h: true, load: fromBinance },
  { name: "twelvedata", native4h: true, load: fromTwelveData },
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
