// Layer 1 — Data. Unified market snapshot for the research agents.
// Uses Yahoo Finance for FX/metals/indices and CoinGecko for crypto.
// Deliberately independent from src/routes/api.ohlc.ts so this layer can be
// swapped for OpenBB or another provider without touching the chart route.

import type { Candle, MarketSnapshot } from "./types";

const YAHOO: Record<string, string> = {
  "XAU/USD": "GC=F",
  "XAG/USD": "SI=F",
  "NAS100": "QQQ",
  "SPX500": "SPY",
  "US30": "DIA",
  "WTI Oil": "CL=F",
  "EUR/USD": "EURUSD=X",
  "GBP/USD": "GBPUSD=X",
  "USD/JPY": "JPY=X",
  "BTC/USD": "BTC-USD",
  "ETH/USD": "ETH-USD",
  "XRP/USD": "XRP-USD",
};

const COINGECKO_ID: Record<string, string> = {
  "BTC/USD": "bitcoin",
  "ETH/USD": "ethereum",
  "XRP/USD": "ripple",
};

function yahooRange(interval: string): { interval: string; range: string } {
  switch (interval) {
    case "1":   return { interval: "1m",  range: "1d" };
    case "5":   return { interval: "5m",  range: "5d" };
    case "15":  return { interval: "15m", range: "5d" };
    case "60":  return { interval: "1h",  range: "1mo" };
    case "240": return { interval: "1h",  range: "3mo" };
    case "D":   return { interval: "1d",  range: "6mo" };
    case "W":   return { interval: "1wk", range: "2y" };
    case "M":   return { interval: "1mo", range: "5y" };
    default:    return { interval: "1h",  range: "1mo" };
  }
}

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally { clearTimeout(t); }
}

async function fromYahoo(ticker: string, interval: string): Promise<Candle[]> {
  const sym = YAHOO[ticker];
  if (!sym) throw new Error(`no yahoo mapping for ${ticker}`);
  const iv = yahooRange(interval);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv.interval}&range=${iv.range}`;
  const json = await fetchJson<{
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: (number|null)[]; high?: (number|null)[]; low?: (number|null)[]; close?: (number|null)[] }> } }> };
  }>(url);
  const r = json.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new Error("yahoo empty");
  const bars: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ time: r.timestamp[i], open: o, high: h, low: l, close: c });
  }
  return bars.slice(-220);
}

async function fromCoinGecko(ticker: string, interval: string): Promise<Candle[]> {
  const id = COINGECKO_ID[ticker];
  if (!id) throw new Error(`no cg mapping for ${ticker}`);
  const days = interval === "1" || interval === "5" || interval === "15" ? 1 : interval === "60" || interval === "240" ? 14 : 90;
  const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`;
  const raw = await fetchJson<Array<[number, number, number, number, number]>>(url);
  return raw.map(([ms, o, h, l, c]) => ({ time: Math.floor(ms / 1000), open: o, high: h, low: l, close: c }));
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

function detectHtfBias(candles: Candle[]): "bullish" | "bearish" | "neutral" {
  if (candles.length < 20) return "neutral";
  const g = 4, agg: Candle[] = [];
  for (let i = 0; i + g <= candles.length; i += g) {
    const chunk = candles.slice(i, i + g);
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

function activeSessions(nowUtcH: number): string[] {
  const out: string[] = [];
  if (nowUtcH >= 22 || nowUtcH < 7) out.push("Sydney");
  if (nowUtcH >= 0 && nowUtcH < 9) out.push("Tokyo");
  if (nowUtcH >= 8 && nowUtcH < 17) out.push("London");
  if (nowUtcH >= 13 && nowUtcH < 22) out.push("New York");
  return out;
}

export async function getSnapshot(ticker: string, interval: string): Promise<MarketSnapshot> {
  let candles: Candle[] = [];
  let source: MarketSnapshot["source"] = "unavailable";
  try {
    if (COINGECKO_ID[ticker]) { candles = await fromCoinGecko(ticker, interval); source = "coingecko"; }
    else { candles = await fromYahoo(ticker, interval); source = "yahoo"; }
  } catch {
    if (YAHOO[ticker] && source === "unavailable") {
      try { candles = await fromYahoo(ticker, interval); source = "yahoo"; } catch { /* remain unavailable */ }
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
  };
}
