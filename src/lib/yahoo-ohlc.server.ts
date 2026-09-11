// Yahoo chart candles — the backup history feed for instruments OANDA is the
// only mapped provider for (indices, energy). An OANDA token that is expired or
// issued for the other environment answers 401, which used to leave index
// charts and any scan built on them completely empty.
export type YahooBar = { time: number; open: number; high: number; low: number; close: number; volume?: number };

const MAP: Record<string, string> = {
  NAS100: "^NDX",
  US100: "^NDX",
  SPX500: "^GSPC",
  US500: "^GSPC",
  US30: "^DJI",
  US2000: "^RUT",
  GER40: "^GDAXI",
  UK100: "^FTSE",
  JPN225: "^N225",
  JP225: "^N225",
  "WTI OIL": "CL=F",
  USOIL: "CL=F",
  "BRENT OIL": "BZ=F",
  NATGAS: "NG=F",
  "XAU/USD": "GC=F",
  "XAG/USD": "SI=F",
};

/** Platform ticker -> Yahoo chart symbol, or null when Yahoo has no clean match. */
export function tickerToYahoo(ticker: string): string | null {
  const t = ticker.toUpperCase().trim();
  if (MAP[t]) return MAP[t];
  const fx = t.match(/^([A-Z]{3})\/([A-Z]{3})$/);
  if (fx) return `${fx[1]}${fx[2]}=X`;
  return null;
}

function yahooRange(interval: string): { interval: string; range: string; aggregate4h: boolean } {
  switch (interval) {
    case "1": return { interval: "1m", range: "2d", aggregate4h: false };
    case "5": return { interval: "5m", range: "1mo", aggregate4h: false };
    case "15": return { interval: "15m", range: "1mo", aggregate4h: false };
    case "30": return { interval: "30m", range: "1mo", aggregate4h: false };
    case "60": return { interval: "60m", range: "3mo", aggregate4h: false };
    case "240": return { interval: "60m", range: "6mo", aggregate4h: true };
    case "D": return { interval: "1d", range: "2y", aggregate4h: false };
    case "W": return { interval: "1wk", range: "5y", aggregate4h: false };
    case "M": return { interval: "1mo", range: "10y", aggregate4h: false };
    default: return { interval: "60m", range: "3mo", aggregate4h: false };
  }
}

function to4h(bars: YahooBar[]): YahooBar[] {
  const out: YahooBar[] = [];
  for (const bar of bars) {
    const bucket = Math.floor(bar.time / 14_400) * 14_400;
    const last = out.at(-1);
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume = (last.volume ?? 0) + (bar.volume ?? 0);
    } else {
      out.push({ ...bar, time: bucket });
    }
  }
  return out;
}

/** Fetch up to 220 recent bars for one platform ticker. Throws when unavailable. */
export async function fetchYahooBars(ticker: string, interval: string): Promise<YahooBar[]> {
  const symbol = tickerToYahoo(ticker);
  if (!symbol) throw new Error(`no yahoo mapping for ${ticker}`);
  const cfg = yahooRange(interval);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let json: unknown;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const result = (json as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
      }>;
    };
  }).chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  if (!stamps.length || !quote) throw new Error("Yahoo: no candles");
  const bars: YahooBar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const o = quote.open?.[i], h = quote.high?.[i], l = quote.low?.[i], c = quote.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || h < l) continue;
    const v = quote.volume?.[i];
    bars.push({ time: stamps[i], open: o, high: h, low: l, close: c, volume: v == null ? undefined : v });
  }
  const shaped = cfg.aggregate4h ? to4h(bars) : bars;
  if (shaped.length === 0) throw new Error("Yahoo: no usable candles");
  return shaped.slice(-220);
}
