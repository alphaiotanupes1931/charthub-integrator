// Long-range historical bars for the backtester.
//
// The chart route only needs the last ~220 candles; a backtest needs years.
// Yahoo's chart endpoint covers FX, metals, indices and crypto with enough
// history for every timeframe offered in the UI, and 4H is aggregated from 1H
// because Yahoo does not serve a native 4H series.

import type { BtBar } from "./engine";
import type { BacktestTimeframe } from "./catalog";

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

// Yahoo caps intraday history: 60 days for minute data, 730 days for hourly.
function requestFor(tf: BacktestTimeframe, lookback: string): { interval: string; range: string } {
  if (tf === "15") return { interval: "15m", range: "60d" };
  if (tf === "60" || tf === "240") return { interval: "1h", range: lookback === "max" ? "730d" : "730d" };
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

async function fetchYahoo(symbol: string, interval: string, range: string): Promise<BtBar[]> {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let lastError = "";
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as YahooChart;
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
      if (bars.length > 0) return bars;
      lastError = "no usable bars";
    } catch (e) {
      lastError = (e as Error).message;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Historical data unavailable for ${symbol} (${lastError})`);
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

export async function getHistory(
  symbol: string,
  timeframe: BacktestTimeframe,
  lookback: string,
): Promise<{ bars: BtBar[]; source: string }> {
  const mapped = YAHOO_SYMBOL[symbol];
  if (!mapped) throw new Error(`No historical feed mapped for ${symbol}`);
  const { interval, range } = requestFor(timeframe, lookback);
  const raw = await fetchYahoo(mapped, interval, range);
  const bars = timeframe === "240" ? to4h(raw) : raw;
  return { bars, source: `yahoo:${interval}/${range}` };
}
