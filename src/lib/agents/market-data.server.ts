// Layer 1 - Data. Unified market snapshot for the research agents.
// Feed order matches the chart route exactly (OANDA -> Binance -> Twelve Data)
// so a signal and the chart a trader is looking at are always the same prices.

import type { Candle, MarketSnapshot, MtfContext, TimeframeRead } from "./types";
import { computeOrderFlow } from "./order-flow.server";
import { computeOrderBlocks, rankOrderBlocks } from "@/lib/orderBlocks";

// Canonical instrument keys the app speaks. Provider-specific symbols live in
// the OANDA / BINANCE / TWELVE_DATA maps below.
const CANONICAL = new Set([
  "XAU/USD", "XAG/USD", "XPT/USD", "NAS100", "SPX500", "US30", "GER40", "UK100", "JPN225",
  "WTI Oil", "Brent Oil", "NATGAS", "EUR/USD", "GBP/USD", "USD/JPY",
  "BTC/USD", "ETH/USD", "XRP/USD", "SOL/USD", "DOGE/USD",
]);

// Accepts the many ways a symbol can arrive (watchlists, chat, deep links)
// and maps it onto a canonical key.
const TICKER_ALIASES: Record<string, string> = {
  XAUUSD: "XAU/USD", GOLD: "XAU/USD", "GC=F": "XAU/USD",
  XAGUSD: "XAG/USD", SILVER: "XAG/USD", "SI=F": "XAG/USD",
  EURUSD: "EUR/USD", GBPUSD: "GBP/USD", USDJPY: "USD/JPY",
  BTCUSD: "BTC/USD", "BTC-USD": "BTC/USD",
  ETHUSD: "ETH/USD", "ETH-USD": "ETH/USD",
  XRPUSD: "XRP/USD", "XRP-USD": "XRP/USD",
  "^NDX": "NAS100", NDX: "NAS100", NAS: "NAS100", USTEC: "NAS100", NASDAQ: "NAS100",
  "^GSPC": "SPX500", SPX: "SPX500", SP500: "SPX500", US500: "SPX500",
  "^DJI": "US30", DJI: "US30", DOW: "US30",
  "CL=F": "WTI Oil", USOIL: "WTI Oil", WTI: "WTI Oil",
};

export function normalizeTicker(raw: string): string {
  const t = (raw ?? "").trim();
  if (!t) return t;
  if (CANONICAL.has(t)) return t;
  const upper = t.toUpperCase().replace(/^OANDA:/, "").replace(/\s+/g, "");
  return TICKER_ALIASES[upper] ?? TICKER_ALIASES[t] ?? t;
}



async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally { clearTimeout(t); }
}

const OANDA: Record<string, string> = {
  "XAU/USD": "XAU_USD",
  "XAG/USD": "XAG_USD",
  "XPT/USD": "XPT_USD",
  "NAS100": "NAS100_USD",
  "SPX500": "SPX500_USD",
  "US30": "US30_USD",
  "GER40": "DE30_EUR",
  "UK100": "UK100_GBP",
  "JPN225": "JP225_USD",
  "WTI Oil": "WTICO_USD",
  "Brent Oil": "BCO_USD",
  "NATGAS": "NATGAS_USD",
};

const CRYPTO_BASES = new Set([
  "BTC", "ETH", "XRP", "SOL", "DOGE", "ADA", "LTC", "BCH", "LINK", "AVAX",
  "DOT", "MATIC", "TRX", "XLM", "ATOM", "UNI", "ETC", "FIL", "NEAR", "APT",
  "ARB", "OP", "SUI", "TON", "SHIB", "PEPE", "PAXG", "BNB",
]);

/** True for crypto tickers, including ones shaped like an FX pair (ETH/USD). */
export function isCryptoTicker(ticker: string): boolean {
  const t = (ticker ?? "").toUpperCase().replace(/\s+/g, "");
  const head = t.split("/")[0] ?? "";
  return CRYPTO_BASES.has(head) || CRYPTO_BASES.has(head.replace(/(USD|USDT)$/, ""));
}

function oandaInstrument(ticker: string): string | null {
  if (OANDA[ticker]) return OANDA[ticker];
  // Crypto never goes to OANDA: "ETH/USD" matches the FX shape below, and the
  // OANDA crypto CFD feed is stale, which produced A+ signals hundreds of
  // dollars away from real Ethereum spot. Crypto history comes from Binance.
  if (isCryptoTicker(ticker)) return null;
  // Any plain FX pair OANDA quotes, e.g. "EUR/USD" -> "EUR_USD".
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(ticker.toUpperCase())) return ticker.toUpperCase().replace("/", "_");
  return null;
}

function oandaGranularity(interval: string): string {
  return ({ "1": "M1", "5": "M5", "15": "M15", "60": "H1", "240": "H4", D: "D", W: "W", M: "M" } as Record<string, string>)[interval] ?? "H1";
}

async function fromOandaHost(host: string, key: string, ticker: string, interval: string): Promise<Candle[]> {
  const instrument = oandaInstrument(ticker);
  if (!instrument) throw new Error(`no oanda mapping for ${ticker}`);
  const url = `https://${host}/v3/instruments/${instrument}/candles?granularity=${oandaGranularity(interval)}&count=220&price=M`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8_000);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`oanda HTTP ${res.status}`);
    const json = await res.json() as { candles?: Array<{ time: string; mid?: { o: string; h: string; l: string; c: string }; volume?: number }> };
    const bars = (json.candles ?? []).flatMap((c): Candle[] => {
      if (!c.mid) return [];
      const open = Number(c.mid.o), high = Number(c.mid.h), low = Number(c.mid.l), close = Number(c.mid.c);
      if (![open, high, low, close].every(Number.isFinite)) return [];
      return [{ time: Math.floor(new Date(c.time).getTime() / 1000), open, high, low, close, volume: c.volume }];
    });
    if (bars.length < 20) throw new Error("oanda returned insufficient candles");
    return bars;
  } finally {
    clearTimeout(timer);
  }
}

async function fromOanda(ticker: string, interval: string): Promise<Candle[]> {
  const key = process.env.OANDA_API_KEY;
  if (!key || !oandaInstrument(ticker)) throw new Error("oanda not configured for ticker");
  const practiceFirst = (process.env.OANDA_ENV ?? "live").toLowerCase() === "practice";
  const hosts = practiceFirst
    ? ["api-fxpractice.oanda.com", "api-fxtrade.oanda.com"]
    : ["api-fxtrade.oanda.com", "api-fxpractice.oanda.com"];
  let lastError: unknown;
  for (const host of hosts) {
    try { return await fromOandaHost(host, key, ticker, interval); }
    catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("oanda unavailable");
}

// Optional paid provider. Enabled automatically when TWELVE_DATA_API_KEY is set.
const TWELVE_DATA: Record<string, string> = {
  "XAU/USD": "XAU/USD",
  "XAG/USD": "XAG/USD",
  "EUR/USD": "EUR/USD",
  "GBP/USD": "GBP/USD",
  "USD/JPY": "USD/JPY",
  // Crypto is deliberately absent: the chart reads Binance, so scans must too,
  // or a Binance hiccup grades Ethereum off a different venue's price scale.
  "WTI Oil": "WTI/USD",
};


function twelveInterval(interval: string): string {
  switch (interval) {
    case "1": return "1min";
    case "5": return "5min";
    case "15": return "15min";
    case "60": return "1h";
    case "240": return "4h";
    case "D": return "1day";
    case "W": return "1week";
    case "M": return "1month";
    default: return "1h";
  }
}

async function fromTwelveData(ticker: string, interval: string): Promise<Candle[]> {
  const key = process.env.TWELVE_DATA_API_KEY;
  const sym = TWELVE_DATA[ticker];
  if (!key || !sym) throw new Error("twelvedata not configured for ticker");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${twelveInterval(interval)}&outputsize=220&order=ASC&apikey=${key}`;
  const json = await fetchJson<{ values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>; status?: string }>(url);
  if (!json.values?.length) throw new Error("twelvedata empty");
  return json.values.map((v) => ({
    time: Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000),
    open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
    volume: v.volume == null ? undefined : Number(v.volume),
  })).filter((c) => Number.isFinite(c.close));
}

// ----- Binance klines (no key, very reliable) -----
// Gold trades on Binance as PAXG (Paxos Gold, 1 token = 1 troy oz) which tracks
// XAU/USD spot closely, so it is a usable last-resort history source for gold.
const BINANCE: Record<string, string> = {
  "XAU/USD": "PAXGUSDT",
  "SOL/USD": "SOLUSDT",
  "DOGE/USD": "DOGEUSDT",
  "BTC/USD": "BTCUSDT",
  "ETH/USD": "ETHUSDT",
  "XRP/USD": "XRPUSDT",
};

function binanceInterval(interval: string): string {
  return ({ "1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", D: "1d", W: "1w", M: "1M" } as Record<string, string>)[interval] ?? "1h";
}

async function fromBinance(ticker: string, interval: string): Promise<Candle[]> {
  const crypto = ticker.toUpperCase().match(/^([A-Z]{2,6})\/(USD|USDT)$/);
  const sym = BINANCE[ticker] ?? (crypto ? `${crypto[1]}USDT` : undefined);
  if (!sym) throw new Error(`no binance mapping for ${ticker}`);
  const url = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${binanceInterval(interval)}&limit=220`;
  const raw = await fetchJson<Array<[number, string, string, string, string, string]>>(url);
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("binance empty");
  return raw.map(([ms, o, h, l, c, v]) => ({
    time: Math.floor(ms / 1000),
    open: Number(o), high: Number(h), low: Number(l), close: Number(c),
    volume: Number(v),
  })).filter((c) => Number.isFinite(c.close));
}

// Last-good candles per ticker/interval. When every provider is rate-limited we
// serve the most recent good history instead of collapsing the scan to NO ENTRY.
const lastGood = new Map<string, { at: number; candles: Candle[] }>();
const LAST_GOOD_TTL_MS = 20 * 60 * 1000;

function rememberCandles(ticker: string, interval: string, candles: Candle[]) {
  if (candles.length >= 20) lastGood.set(`${ticker}:${interval}`, { at: Date.now(), candles });
}

function recallCandles(ticker: string, interval: string): Candle[] {
  const hit = lastGood.get(`${ticker}:${interval}`);
  if (!hit || Date.now() - hit.at > LAST_GOOD_TTL_MS) return [];
  return hit.candles;
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function detectCisd(candles: Candle[]) {
  const empty = { state: "none" as const, level: 0, trigger: 0, proj1: 0, proj2: 0 };
  if (candles.length < 6) return empty;
  for (let i = candles.length - 1; i >= 3; i--) {
    const c = candles[i];
    const isUp = c.close > c.open;
    const isDn = c.close < c.open;
    if (!isUp && !isDn) continue;
    let j = i - 1;
    let extreme = isUp ? -Infinity : Infinity;
    let lo = Infinity, hi = -Infinity;
    while (j >= 0) {
      const p = candles[j];
      const opposing = isUp ? p.close < p.open : p.close > p.open;
      if (!opposing) break;
      extreme = isUp ? Math.max(extreme, p.open) : Math.min(extreme, p.open);
      lo = Math.min(lo, p.low); hi = Math.max(hi, p.high);
      j--;
    }
    if (i - 1 - j < 2) continue;
    const flipped = isUp ? c.close > extreme : c.close < extreme;
    if (!flipped) continue;
    const legSize = Math.max(1e-9, hi - lo);
    const trigger = c.close;
    return {
      state: isUp ? ("bullish" as const) : ("bearish" as const),
      level: extreme,
      trigger,
      proj1: isUp ? trigger + legSize : trigger - legSize,
      proj2: isUp ? trigger + legSize * 2 : trigger - legSize * 2,
    };
  }
  return empty;
}

/**
 * Higher-timeframe bias from aggregated candles.
 *
 * The grouping is anchored to the NEWEST candle, not the oldest. Anchoring at
 * index 0 silently threw away the newest 1-3 candles whenever the series length
 * was not a multiple of the group size, which is how a +300pt NAS100 day could
 * still read "bearish" off Tuesday's bars.
 */
function detectHtfBias(candles: Candle[]): "bullish" | "bearish" | "neutral" {
  if (candles.length < 20) return "neutral";
  const g = 4;
  const window = candles.slice(-48); // ~8 trading days of 4H, recent only
  const start = window.length % g;   // drop the OLDEST remainder, keep the newest bar
  const agg: Candle[] = [];
  for (let i = start; i + g <= window.length; i += g) {
    const chunk = window.slice(i, i + g);
    agg.push({
      time: chunk[0].time,
      open: chunk[0].open,
      close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
    });
  }
  const c = detectCisd(agg);
  return c.state === "none" ? "neutral" : c.state;
}

/**
 * Trend from swing structure: higher highs + higher lows = up, lower highs +
 * lower lows = down, anything else = range. Structure beats a regression line
 * because a regression over a week of bars keeps quoting last week's direction
 * after price has already broken the other way.
 */
function swingTrend(candles: Candle[]): "up" | "down" | "range" {
  if (candles.length < 8) return "range";
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    if (c.high > candles[i - 1].high && c.high > candles[i - 2].high && c.high > candles[i + 1].high && c.high > candles[i + 2].high) highs.push(c.high);
    if (c.low < candles[i - 1].low && c.low < candles[i - 2].low && c.low < candles[i + 1].low && c.low < candles[i + 2].low) lows.push(c.low);
  }
  const hh = highs.length >= 2 && highs.at(-1)! > highs.at(-2)!;
  const lh = highs.length >= 2 && highs.at(-1)! < highs.at(-2)!;
  const hl = lows.length >= 2 && lows.at(-1)! > lows.at(-2)!;
  const ll = lows.length >= 2 && lows.at(-1)! < lows.at(-2)!;
  if (hh && hl) return "up";
  if (lh && ll) return "down";
  return "range";
}


function activeSessions(nowUtcH: number): string[] {
  const out: string[] = [];
  if (nowUtcH >= 22 || nowUtcH < 7) out.push("Sydney");
  if (nowUtcH >= 0 && nowUtcH < 9) out.push("Tokyo");
  if (nowUtcH >= 8 && nowUtcH < 17) out.push("London");
  if (nowUtcH >= 13 && nowUtcH < 22) out.push("New York");
  return out;
}

// ---------------- Multi-timeframe (MTF) helpers ----------------
// Implements the "How to Analysis" cascade: 4H direction/trend/key levels/S&D
// → 1H structure (breaks, reversal, OB, FVG, liquidity) → 15m confirmation.

function slope(closes: number[]): number {
  if (closes.length < 2) return 0;
  const n = closes.length;
  const xMean = (n - 1) / 2;
  const yMean = closes.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (closes[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function h4Analysis(candles: Candle[]): MtfContext["h4"] {
  const closes = candles.map((c) => c.close);
  const last = closes.at(-1) ?? 0;
  const atrV = atr(candles) || Math.max(last * 0.002, 1e-9);

  // Trend is read off recent swing structure first (last ~24 bars = ~4 days),
  // then a SHORT regression (14 bars = ~2 days) only as a tie-breaker. The old
  // version fit a line through 40 bars, so a multi-day rally still printed
  // "down" because the prior week's selloff dominated the fit.
  const struct = swingTrend(candles.slice(-24));
  const recent = closes.slice(-14);
  const sl = slope(recent);
  const magnitude = Math.abs(sl) / Math.max(last, 1e-9);
  let trend: "up" | "down" | "range" =
    struct !== "range" ? struct : magnitude < 0.0002 ? "range" : sl > 0 ? "up" : "down";

  // Recency guard: a decisive move over the last ~1.5 days outranks any older
  // label. Without this the read stays stuck on stale direction after a flip.
  if (closes.length >= 8) {
    const net = last - closes[closes.length - 8];
    if (Math.abs(net) > atrV * 1.5) {
      if (net > 0 && trend === "down") trend = "up";
      else if (net < 0 && trend === "up") trend = "down";
    }
  }

  const cisd = detectCisd(candles);
  const bias = detectHtfBias(candles);
  let direction: "bullish" | "bearish" | "neutral" =
    bias !== "neutral" ? bias : cisd.state !== "none" ? cisd.state : "neutral";

  // A CISD flip can sit in the series for days. When the live swing structure
  // says the opposite, the older flip is stale and the structure wins - that is
  // the whole point of the 2026-09-03 index miss, where a Tuesday sell flip kept
  // the read bearish through a 600pt US30 rally.
  if (direction === "bearish" && trend === "up") direction = "bullish";
  else if (direction === "bullish" && trend === "down") direction = "bearish";



  // Key swing levels: last few swing highs/lows via 3-bar fractal.
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = candles.length - 3; i >= 2; i--) {
    const c = candles[i];
    if (c.low < candles[i - 1].low && c.low < candles[i - 2].low && c.low < candles[i + 1].low && (candles[i + 2] ? c.low < candles[i + 2].low : true)) {
      if (c.low < last) supports.push(c.low);
    }
    if (c.high > candles[i - 1].high && c.high > candles[i - 2].high && c.high > candles[i + 1].high && (candles[i + 2] ? c.high > candles[i + 2].high : true)) {
      if (c.high > last) resistances.push(c.high);
    }
    if (supports.length >= 3 && resistances.length >= 3) break;
  }

  // Supply/demand: base (2-3 tight candles) then impulse away.
  const supply: [number, number][] = [];
  const demand: [number, number][] = [];
  for (let i = 3; i < candles.length - 1; i++) {
    const base = candles.slice(i - 2, i + 1);
    const baseHi = Math.max(...base.map((c) => c.high));
    const baseLo = Math.min(...base.map((c) => c.low));
    const baseRange = baseHi - baseLo;
    const impulse = candles[i + 1];
    const impRange = impulse.high - impulse.low;
    if (impRange < baseRange * 1.6) continue;
    if (impulse.close > impulse.open && impulse.close > baseHi) demand.push([baseLo, baseHi]);
    else if (impulse.close < impulse.open && impulse.close < baseLo) supply.push([baseLo, baseHi]);
  }

  return {
    direction,
    trend,
    keyLevels: { support: supports.slice(0, 3), resistance: resistances.slice(0, 3) },
    supplyDemand: { supply: supply.slice(-2), demand: demand.slice(-2) },
  };
}

function h1Analysis(candles: Candle[], h4Direction: MtfContext["h4"]["direction"]): MtfContext["h1"] {
  const cisd = detectCisd(candles);
  const structureBreak = cisd.state;

  // Reversal proxy: last 3 candles flip direction vs prior 5.
  let reversal: "bullish" | "bearish" | "none" = "none";
  if (candles.length >= 8) {
    const prior = candles.slice(-8, -3);
    const last3 = candles.slice(-3);
    const priorDir = prior[prior.length - 1].close - prior[0].close;
    const lastDir = last3[last3.length - 1].close - last3[0].close;
    if (priorDir < 0 && lastDir > 0 && Math.abs(lastDir) > Math.abs(priorDir) * 0.4) reversal = "bullish";
    else if (priorDir > 0 && lastDir < 0 && Math.abs(lastDir) > Math.abs(priorDir) * 0.4) reversal = "bearish";
  }

  // FVG: 3-candle imbalance.
  const bullFvg: [number, number][] = [];
  const bearFvg: [number, number][] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], c = candles[i];
    if (a.high < c.low) bullFvg.push([a.high, c.low]);
    if (a.low > c.high) bearFvg.push([c.high, a.low]);
  }

  // Liquidity: equal highs/lows within 0.1% tolerance.
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const buyside: number[] = [];
  const sellside: number[] = [];
  const tol = (candles.at(-1)?.close ?? 1) * 0.001;
  for (let i = 0; i < highs.length; i++) {
    for (let j = i + 3; j < highs.length; j++) {
      if (Math.abs(highs[i] - highs[j]) <= tol) { buyside.push((highs[i] + highs[j]) / 2); break; }
    }
    for (let j = i + 3; j < lows.length; j++) {
      if (Math.abs(lows[i] - lows[j]) <= tol) { sellside.push((lows[i] + lows[j]) / 2); break; }
    }
  }

  const last = candles.at(-1)?.close ?? 0;
  const atr1h = atr(candles) || Math.max(last * 0.002, 1e-9);
  const rankedBlocks = rankOrderBlocks(computeOrderBlocks(candles, { max: 12 }), {
    bias: h4Direction === "bearish" ? "bearish" : "bullish",
    price: last,
    atr: atr1h,
    h4Direction,
    sweptLiquidity: h4Direction === "bearish" ? buyside : sellside,
  });
  const allBlocks = computeOrderBlocks(candles, { max: 12 });
  const details = [
    ...rankedBlocks,
    ...allBlocks.filter((block) => !rankedBlocks.some((ranked) => ranked.time === block.time && ranked.kind === block.kind)).map((block) => ({
      ...block,
      quality: Math.round(Math.min(100, (block.mitigations === 0 ? 38 : 10) + Math.min(28, block.strength * 14))),
      qualityLabel: "low" as const,
      aligned: false,
      liquiditySweep: false,
      distanceAtr: Number((Math.abs(last - (block.kind === "bullish" ? block.top : block.bot)) / atr1h).toFixed(2)),
    })),
  ];
  const bullOB = details.filter((block) => block.kind === "bullish").map((block) => [block.bot, block.top] as [number, number]);
  const bearOB = details.filter((block) => block.kind === "bearish").map((block) => [block.bot, block.top] as [number, number]);

  return {
    structureBreak,
    reversal,
    orderBlocks: { bull: bullOB.slice(0, 4), bear: bearOB.slice(0, 4) },
    orderBlockDetails: details,
    fvg: { bull: bullFvg.slice(-2), bear: bearFvg.slice(-2) },
    liquidity: { buyside: buyside.slice(-3), sellside: sellside.slice(-3) },
  };
}

function m15Confirmation(candles: Candle[]): MtfContext["m15"] {
  const cisd = detectCisd(candles);
  if (cisd.state !== "none") {
    return { confirmation: cisd.state, reason: `15m CISD flip (${cisd.state}) at ${cisd.trigger.toFixed(4)}` };
  }
  if (candles.length >= 4) {
    const last = candles.slice(-3);
    const up = last.every((c) => c.close > c.open);
    const dn = last.every((c) => c.close < c.open);
    if (up) return { confirmation: "bullish", reason: "3 consecutive 15m bull closes" };
    if (dn) return { confirmation: "bearish", reason: "3 consecutive 15m bear closes" };
  }
  return { confirmation: "none", reason: "No 15m confirmation yet - wait for CISD or momentum flip" };
}

function computeAlignment(mtf: Omit<MtfContext, "alignment">): MtfContext["alignment"] {
  const dir = mtf.h4.direction;
  const struct = mtf.h1.structureBreak !== "none" ? mtf.h1.structureBreak : mtf.h1.reversal;
  const conf = mtf.m15.confirmation;
  if (dir === "bullish" && (struct === "bullish" || struct === "none") && (conf === "bullish" || conf === "none")) {
    return struct === "bullish" && conf === "bullish" ? "aligned-long" : "mixed";
  }
  if (dir === "bearish" && (struct === "bearish" || struct === "none") && (conf === "bearish" || conf === "none")) {
    return struct === "bearish" && conf === "bearish" ? "aligned-short" : "mixed";
  }
  if (dir === "neutral" && struct === "none" && conf === "none") return "none";
  return "mixed";
}

async function loadCandlesSafe(ticker: string, interval: string): Promise<Candle[]> {
  const loaders = [
    () => fromOanda(ticker, interval),
    () => fromBinance(ticker, interval),
    () => fromTwelveData(ticker, interval),
  ];
  for (const load of loaders) {
    try {
      const candles = await load();
      if (candles.length >= 6) {
        rememberCandles(ticker, interval, candles);
        return candles;
      }
    } catch { /* try the next real history provider */ }
  }
  // Never manufacture candles from a quote, but a recent real history beats none.
  return recallCandles(ticker, interval);
}

// ---------------- Full timeframe ladder (Monthly → 1m) ----------------

const LADDER: Array<{ label: TimeframeRead["label"]; interval: string }> = [
  { label: "Monthly", interval: "M" },
  { label: "Weekly", interval: "W" },
  { label: "Daily", interval: "D" },
  { label: "4H", interval: "240" },
  { label: "1H", interval: "60" },
  { label: "15m", interval: "15" },
  { label: "5m", interval: "5" },
  { label: "1m", interval: "1" },
];

function readTimeframe(label: TimeframeRead["label"], interval: string, candles: Candle[]): TimeframeRead | null {
  if (candles.length < 6) return null;
  const closes = candles.map((c) => c.close);
  const last = closes.at(-1) ?? 0;

  // Same rules as h4Analysis: swing structure first, a SHORT slope as tie-breaker,
  // then a recency override. The ladder used to fit a line through 40 bars, so
  // every rung could print last week's direction after price had already flipped -
  // and the model, seeing "4H bias=bearish trend=down" next to a bullish 4H block,
  // would hedge into NO ENTRY. Gold sat in that state for two days.
  const atrV = atr(candles) || Math.max(last * 0.002, 1e-9);
  const struct = swingTrend(candles.slice(-24));
  const sl = slope(closes.slice(-14));
  const magnitude = Math.abs(sl) / Math.max(last, 1e-9);
  let trend: TimeframeRead["trend"] =
    struct !== "range" ? struct : magnitude < 0.0002 ? "range" : sl > 0 ? "up" : "down";
  if (closes.length >= 8) {
    const net = last - closes[closes.length - 8];
    if (Math.abs(net) > atrV * 1.5) {
      if (net > 0 && trend === "down") trend = "up";
      else if (net < 0 && trend === "up") trend = "down";
    }
  }

  const cisd = detectCisd(candles);
  const htf = detectHtfBias(candles);
  let bias: TimeframeRead["bias"] =
    htf !== "neutral" ? htf : cisd.state !== "none" ? cisd.state : trend === "up" ? "bullish" : trend === "down" ? "bearish" : "neutral";
  // A stale flip never outranks live structure on the same rung.
  if (bias === "bearish" && trend === "up") bias = "bullish";
  else if (bias === "bullish" && trend === "down") bias = "bearish";

  const ref = closes.length >= 20 ? closes[closes.length - 20] : closes[0];
  return {
    label,
    interval,
    bias,
    trend,
    structure: cisd.state,
    last,
    high: Math.max(...candles.slice(-40).map((c) => c.high)),
    low: Math.min(...candles.slice(-40).map((c) => c.low)),
    changePct: ref ? ((last - ref) / ref) * 100 : 0,
    bars: candles.length,
  };
}


/**
 * Monthly → 1m read of the same instrument.
 *
 * Deliberately NOT cached. Every rung of this ladder feeds the directional bias,
 * and a stale rung is exactly how the 2026-09-03 GBP/USD bias lock happened: the
 * narrative kept quoting a "4H bearish" label that the live candles had already
 * invalidated. recomputeMtfBias() is cheap arithmetic, so it runs every scan.
 */
export async function getTimeframeLadder(ticker: string): Promise<TimeframeRead[]> {
  const rows = await Promise.all(
    LADDER.map(async (tf) => readTimeframe(tf.label, tf.interval, await loadCandlesSafe(ticker, tf.interval))),
  );
  return rows.filter((r): r is TimeframeRead => r !== null);
}

export function formatLadder(rows: TimeframeRead[]): string {
  if (!rows.length) return "Timeframe ladder: unavailable";
  const d = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(4));
  return [
    "TIMEFRAME LADDER (Monthly → 1m, computed server-side from live candles - you CAN see every one of these):",
    ...rows.map(
      (r) =>
        `  ${r.label.padEnd(7)} bias=${r.bias} trend=${r.trend} structure=${r.structure} last=${d(r.last)} range=${d(r.low)}-${d(r.high)} chg=${r.changePct.toFixed(2)}% (${r.bars} bars)`,
    ),
  ].join("\n");
}

async function buildMtf(
  ticker: string,
  primaryInterval: string,
  primaryCandles: Candle[],
): Promise<{ mtf: MtfContext; candles4h: Candle[]; candles1h: Candle[]; candles15m: Candle[]; candles5m: Candle[] } | undefined> {
  const useH4 = primaryInterval === "240" ? primaryCandles : await loadCandlesSafe(ticker, "240");
  const useH1 = primaryInterval === "60"  ? primaryCandles : await loadCandlesSafe(ticker, "60");
  const use15 = primaryInterval === "15"  ? primaryCandles : await loadCandlesSafe(ticker, "15");
  const use5 = primaryInterval === "5" ? primaryCandles : await loadCandlesSafe(ticker, "5");
  if (useH4.length < 20 || useH1.length < 20 || use15.length < 10) return undefined;
  const h4 = h4Analysis(useH4);
  const base = { h4, h1: h1Analysis(useH1, h4.direction), m15: m15Confirmation(use15) };
  const ladder = await getTimeframeLadder(ticker).catch(() => [] as TimeframeRead[]);
  return { mtf: { ...base, alignment: computeAlignment(base), ladder }, candles4h: useH4, candles1h: useH1, candles15m: use15, candles5m: use5 };
}


export async function getSnapshot(rawTicker: string, interval: string): Promise<MarketSnapshot> {
  const ticker = normalizeTicker(rawTicker);
  let candles: Candle[] = [];

  let source: MarketSnapshot["source"] = "unavailable";
  // Same feed order as the charts so a signal and its chart never disagree.
  const loaders: Array<{ source: Exclude<MarketSnapshot["source"], "backup" | "unavailable" | "cached">; load: () => Promise<Candle[]> }> = [
    { source: "oanda", load: () => fromOanda(ticker, interval) },
    { source: "binance", load: () => fromBinance(ticker, interval) },
    { source: "twelvedata", load: () => fromTwelveData(ticker, interval) },
  ];
  for (const provider of loaders) {
    try {
      const next = await provider.load();
      if (next.length < 20) continue;
      candles = next;
      source = provider.source;
      rememberCandles(ticker, interval, next);
      break;
    } catch { /* try the next real history provider */ }
  }
  if (candles.length < 20) {
    const recalled = recallCandles(ticker, interval);
    if (recalled.length >= 20) {
      candles = recalled;
      source = "cached";
    }
  }

  const last = candles.at(-1)?.close ?? 0;
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const slice = (n: number) => ({
    hi: Math.max(...highs.slice(-n)),
    lo: Math.min(...lows.slice(-n)),
  });
  const s20 = candles.length >= 20 ? slice(20) : { hi: last, lo: last };
  const s50 = candles.length >= 50 ? slice(50) : { hi: last, lo: last };
  const first24 = closes.length >= 24 ? closes[closes.length - 24] : closes[0] ?? last;
  const changePct24h = first24 ? ((last - first24) / first24) * 100 : 0;
  const range20Pct = last && s20.hi ? ((s20.hi - s20.lo) / last) * 100 : 0;

  const cisdRaw = detectCisd(candles);
  const htfBias = detectHtfBias(candles);
  const cisd = { ...cisdRaw, htfBias };

  const mtfRead = source === "unavailable" ? undefined : await buildMtf(ticker, interval, candles).catch(() => undefined);
  const mtf = mtfRead?.mtf;
  const candles4h = mtfRead?.candles4h ?? (interval === "240" ? candles : []);

  return {
    ticker,
    interval,
    source,
    lastPrice: last,
    candles,
    stats: {
      high20: s20.hi, low20: s20.lo,
      high50: s50.hi, low50: s50.lo,
      atr14: atr(candles),
      changePct24h,
      range20Pct,
    },
    cisd,
    sessionsActive: activeSessions(new Date().getUTCHours()),
    fetchedAt: new Date().toISOString(),
    mtf,
    orderFlow: computeOrderFlow(candles),
    candles4h,
    atr4h: candles4h.length > 1 ? atr(candles4h) : undefined,
    candles1h: mtfRead?.candles1h,
    candles15m: mtfRead?.candles15m,
    candles5m: mtfRead?.candles5m,
  };
}
