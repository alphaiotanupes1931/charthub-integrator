import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type IPriceLine,
  LineStyle,
  CrosshairMode,
} from "lightweight-charts";
import { getOhlc } from "@/lib/ohlc.functions";
import { useTimeFormat, formatTime } from "@/hooks/useTimeFormat";

export type LevelKey = "VWAP" | "POC" | "SR" | "ZONES" | "FVG" | "FIB" | "LIQ" | "OF";

export const LEVEL_META: Record<LevelKey, { label: string; color: string; tone: string }> = {
  VWAP:  { label: "VWAP",  color: "#fbbf24", tone: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  POC:   { label: "POC",   color: "#c084fc", tone: "bg-purple-500/10 text-purple-300 border-purple-500/30" },
  SR:    { label: "S/R",   color: "#38bdf8", tone: "bg-sky-500/10 text-sky-300 border-sky-500/30" },
  ZONES: { label: "Zones", color: "#60a5fa", tone: "bg-blue-500/10 text-blue-300 border-blue-500/30" },
  FVG:   { label: "FVG",   color: "#34d399", tone: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
  FIB:   { label: "Fib",   color: "#f472b6", tone: "bg-pink-500/10 text-pink-300 border-pink-500/30" },
  LIQ:   { label: "Liq",   color: "#f87171", tone: "bg-red-500/10 text-red-300 border-red-500/30" },
  OF:    { label: "Order Flow", color: "#22d3ee", tone: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" },
};

export type ChartSnapshot = {
  source: "coingecko" | "twelvedata" | "synthetic";
  sourceLabel: string;
  ticker: string;
  interval: string;
  lastPrice: number;
  high20: number;
  low20: number;
  high50: number;
  low50: number;
  vwap: number;
  poc: number;
  sr: number[];
  fib: { ratio: number; price: number }[];
  liq: { price: number; side: "buy" | "sell" }[];
  of: { price: number; side: "buy" | "sell"; strength: number }[];
  delta: number;
  sessionsActive: string[];
  fetchedAt: string;
};

interface Props {
  symbol: string;
  ticker: string;
  interval: string; // 1, 5, 15, 60, 240, D, W, M
  enabled: Record<LevelKey, boolean>;
  sessions?: boolean;
  onSnapshot?: (snap: ChartSnapshot) => void;
  className?: string;
}

// FX session windows in UTC (approximate, ignores DST).
const SESSIONS = [
  { key: "Sydney",   startH: 22, endH: 7,  color: "rgba(56, 189, 248, 0.08)",  label: "Sydney"   }, // sky
  { key: "Tokyo",    startH: 0,  endH: 9,  color: "rgba(244, 114, 182, 0.08)", label: "Tokyo"    }, // pink
  { key: "London",   startH: 8,  endH: 17, color: "rgba(251, 191, 36, 0.08)",  label: "London"   }, // amber
  { key: "New York", startH: 13, endH: 22, color: "rgba(52, 211, 153, 0.08)",  label: "New York" }, // emerald
];


// --- Deterministic PRNG so each (symbol, interval) is stable & 1W ≠ 1M ---
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Map interval -> seconds per bar (so timeframes are visibly different)
function secondsFor(interval: string): number {
  switch (interval) {
    case "1":   return 60;
    case "5":   return 5 * 60;
    case "15":  return 15 * 60;
    case "60":  return 60 * 60;
    case "240": return 4 * 60 * 60;
    case "D":   return 24 * 60 * 60;
    case "W":   return 7 * 24 * 60 * 60;
    case "M":   return 30 * 24 * 60 * 60;
    default:    return 60 * 60;
  }
}

function basePriceFor(ticker: string): number {
  const t = ticker.toUpperCase();
  if (t.includes("XAU")) return 2380;
  if (t.includes("BTC")) return 67000;
  if (t.includes("ETH")) return 3500;
  if (t.includes("NAS")) return 18500;
  if (t.includes("SPX")) return 5200;
  if (t.includes("DJI") || t.includes("US30")) return 39800;
  if (t.includes("JPY")) return 156;
  if (t.includes("EUR")) return 1.08;
  if (t.includes("GBP")) return 1.27;
  return 100;
}

type Candle = { time: Time; open: number; high: number; low: number; close: number };

function generateCandles(symbol: string, interval: string, ticker: string, count = 220): Candle[] {
  const seed = hashSeed(`${symbol}|${interval}`);
  const rnd = mulberry32(seed);
  const stepSec = secondsFor(interval);
  const now = Math.floor(Date.now() / 1000);
  const start = now - stepSec * (count - 1);

  const base = basePriceFor(ticker);
  // Volatility scales with interval — bigger TFs swing more
  const vol = base * (0.0015 + Math.min(stepSec / (60 * 60 * 24 * 30), 1) * 0.03);

  const out: Candle[] = [];
  let price = base * (0.95 + rnd() * 0.1);
  for (let i = 0; i < count; i++) {
    const drift = (rnd() - 0.5) * vol * 0.6;
    const wave = Math.sin(i / (8 + (seed % 7))) * vol * 0.4;
    const open = price;
    const close = Math.max(0.0001, open + drift + wave);
    const high = Math.max(open, close) + rnd() * vol * 0.6;
    const low  = Math.min(open, close) - rnd() * vol * 0.6;
    out.push({
      time: (start + i * stepSec) as Time,
      open, high, low, close,
    });
    price = close;
  }
  return out;
}

// --- Compute levels from candles ---
function computeLevels(candles: Candle[]) {
  if (candles.length === 0) {
    return { vwap: 0, poc: 0, sr: [] as number[], zones: [] as { top: number; bot: number }[], fvg: [] as { top: number; bot: number }[], fib: [] as { ratio: number; price: number }[], liq: [] as { price: number; side: "buy" | "sell" }[], of: [] as { price: number; side: "buy" | "sell"; strength: number }[], delta: 0 };
  }
  // VWAP (using HLC/3 as volume proxy)
  let pvSum = 0, vSum = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    const v = Math.max(1, (c.high - c.low));
    pvSum += typical * v;
    vSum += v;
  }
  const vwap = pvSum / vSum;

  // POC: most "visited" price bin
  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  const bins = 40;
  const step = (hi - lo) / bins || 1;
  const buckets = new Array(bins).fill(0);
  for (const c of candles) {
    const a = Math.max(0, Math.min(bins - 1, Math.floor((c.low - lo) / step)));
    const b = Math.max(0, Math.min(bins - 1, Math.floor((c.high - lo) / step)));
    for (let i = a; i <= b; i++) buckets[i] += 1;
  }
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (buckets[i] > buckets[pocIdx]) pocIdx = i;
  const poc = lo + (pocIdx + 0.5) * step;

  // Swing-based S/R (recent pivots)
  const sr: number[] = [];
  for (let i = 3; i < candles.length - 3; i++) {
    const c = candles[i];
    const isHigh = c.high > candles[i-1].high && c.high > candles[i-2].high && c.high > candles[i+1].high && c.high > candles[i+2].high;
    const isLow  = c.low  < candles[i-1].low  && c.low  < candles[i-2].low  && c.low  < candles[i+1].low  && c.low  < candles[i+2].low;
    if (isHigh) sr.push(c.high);
    if (isLow)  sr.push(c.low);
  }
  const tol = (hi - lo) * 0.005;
  const clustered: number[] = [];
  for (const p of sr.reverse()) {
    if (!clustered.some((q) => Math.abs(q - p) < tol)) clustered.push(p);
    if (clustered.length >= 4) break;
  }

  const zones = [
    { top: poc + step * 1.5, bot: poc - step * 1.5 },
    { top: hi - step * 2,    bot: hi - step * 4 },
  ];

  const fvg: { top: number; bot: number }[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1], next = candles[i + 1];
    if (next.low > prev.high) fvg.push({ top: next.low, bot: prev.high });
    else if (next.high < prev.low) fvg.push({ top: prev.low, bot: next.high });
    if (fvg.length >= 3) break;
  }

  const recent = candles.slice(-60);
  const swingHi = Math.max(...recent.map((c) => c.high));
  const swingLo = Math.min(...recent.map((c) => c.low));
  const range = swingHi - swingLo;
  const fib = [0.236, 0.382, 0.5, 0.618, 0.786].map((r) => ({ ratio: r, price: swingHi - range * r }));

  const last = candles.slice(-30);
  const liq = [
    { price: Math.max(...last.map((c) => c.high)) + step * 0.5, side: "sell" as const },
    { price: Math.min(...last.map((c) => c.low))  - step * 0.5, side: "buy"  as const },
  ];

  // --- Order Flow: per-bar delta proxy from body strength + cumulative delta ---
  // delta = sign(close-open) * |body|/range — strongest absorption/initiative bars
  const scored = candles.slice(-50).map((c) => {
    const body = c.close - c.open;
    const rng = Math.max(1e-9, c.high - c.low);
    const strength = Math.abs(body) / rng; // 0..1
    return { price: (c.high + c.low + c.close) / 3, side: body >= 0 ? ("buy" as const) : ("sell" as const), strength };
  });
  const of = scored
    .filter((s) => s.strength > 0.55)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 4);
  let cum = 0;
  for (const c of candles) {
    const body = c.close - c.open;
    const rng = Math.max(1e-9, c.high - c.low);
    cum += (body / rng);
  }
  const delta = cum;

  return { vwap, poc, sr: clustered, zones, fvg, fib, liq, of, delta };
}

export function NativeChart({ symbol, ticker, interval, enabled, sessions, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const [ready, setReady] = useState(false);
  // Session band positions {key,color,label,left,width} in pixels for the overlay
  const [bands, setBands] = useState<Array<{ key: string; color: string; label: string; left: number; width: number; idx: number }>>([]);

  const fetchOhlc = useServerFn(getOhlc);
  const { data: liveOhlc, isLoading } = useQuery({
    queryKey: ["ohlc", ticker, interval],
    queryFn: () => fetchOhlc({ data: { ticker, interval } }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const hasLive = !!liveOhlc && liveOhlc.source !== "synthetic" && liveOhlc.bars.length > 0;
  const noLiveSource = !!liveOhlc && liveOhlc.source === "synthetic";
  // Don't flash synthetic candles while we're still waiting on the live feed —
  // only fall back to synthetic when the server actually says no live source exists.
  const showLoader = !liveOhlc || (isLoading && !hasLive && !noLiveSource);

  const candles = useMemo<Candle[]>(() => {
    if (hasLive && liveOhlc) {
      return liveOhlc.bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
    }
    if (noLiveSource) return generateCandles(symbol, interval, ticker);
    return [];
  }, [liveOhlc, hasLive, noLiveSource, symbol, interval, ticker]);
  const levels = useMemo(() => computeLevels(candles), [candles]);
  const isLive = hasLive;
  const sourceLabel = liveOhlc?.source === "coingecko" ? "CoinGecko" : liveOhlc?.source === "twelvedata" ? "Twelve Data" : "";

  // Init / teardown chart
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#94a3b8", fontFamily: "ui-sans-serif, system-ui, sans-serif" },
      grid: { vertLines: { color: "rgba(148, 163, 184, 0.06)" }, horzLines: { color: "rgba(148, 163, 184, 0.06)" } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(251, 191, 36, 0.5)", width: 1, style: LineStyle.Solid, labelBackgroundColor: "#fbbf24" },
        horzLine: { color: "rgba(251, 191, 36, 0.5)", width: 1, style: LineStyle.Solid, labelBackgroundColor: "#fbbf24" },
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.15)" },
      timeScale: { borderColor: "rgba(148, 163, 184, 0.15)", timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399", downColor: "#f87171",
      borderUpColor: "#34d399", borderDownColor: "#f87171",
      wickUpColor: "#34d399", wickDownColor: "#f87171",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    setReady(true);
    return () => {
      linesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setReady(false);
    };
  }, []);

  // Push candle data
  useEffect(() => {
    if (!ready || !seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(candles);
    chartRef.current.timeScale().fitContent();
  }, [candles, ready]);

  // Sync overlays from `enabled` toggles
  useEffect(() => {
    if (!ready || !seriesRef.current) return;
    const s = seriesRef.current;
    linesRef.current.forEach((l) => s.removePriceLine(l));
    linesRef.current = [];

    const add = (price: number, color: string, title: string, dashed = false) => {
      const line = s.createPriceLine({
        price, color, lineWidth: 1,
        lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true, title,
      });
      linesRef.current.push(line);
    };

    if (enabled.VWAP) add(levels.vwap, LEVEL_META.VWAP.color, "VWAP");
    if (enabled.POC)  add(levels.poc,  LEVEL_META.POC.color,  "POC", true);
    if (enabled.SR)   levels.sr.forEach((p, i) => add(p, LEVEL_META.SR.color, `S/R ${i + 1}`));
    if (enabled.ZONES) levels.zones.forEach((z, i) => {
      add(z.top, LEVEL_META.ZONES.color, `Zone ${i + 1} ↑`, true);
      add(z.bot, LEVEL_META.ZONES.color, `Zone ${i + 1} ↓`, true);
    });
    if (enabled.FVG) levels.fvg.forEach((g, i) => {
      add(g.top, LEVEL_META.FVG.color, `FVG ${i + 1} ↑`, true);
      add(g.bot, LEVEL_META.FVG.color, `FVG ${i + 1} ↓`, true);
    });
    if (enabled.FIB) levels.fib.forEach((f) => add(f.price, LEVEL_META.FIB.color, `Fib ${f.ratio}`, true));
    if (enabled.LIQ) levels.liq.forEach((l) => add(l.price, LEVEL_META.LIQ.color, l.side === "buy" ? "Buy-side liq" : "Sell-side liq"));
    if (enabled.OF) levels.of.forEach((o, i) =>
      add(o.price, LEVEL_META.OF.color, `${o.side === "buy" ? "OF↑" : "OF↓"} ${i + 1}`, true),
    );
  }, [enabled, levels, ready]);

  // ---- Sessions overlay ----
  useEffect(() => {
    if (!ready || !chartRef.current) { setBands([]); return; }
    if (!sessions) { setBands([]); return; }
    const chart = chartRef.current;

    const recompute = () => {
      const ts = chart.timeScale();
      const visible = ts.getVisibleRange();
      if (!visible) { setBands([]); return; }
      const from = Number(visible.from) * 1000;
      const to = Number(visible.to) * 1000;
      const DAY = 24 * 3600 * 1000;
      // Walk each UTC day in the visible window and emit a band per session.
      const out: Array<{ key: string; color: string; label: string; left: number; width: number; idx: number }> = [];
      const firstDay = Math.floor(from / DAY) * DAY - DAY; // include prev day for sessions crossing midnight
      for (let d = firstDay; d <= to; d += DAY) {
        SESSIONS.forEach((sess, idx) => {
          // session window: [d + startH, d + endH] (endH may wrap to next day if startH > endH)
          const startMs = d + sess.startH * 3600 * 1000;
          const endMs = sess.startH < sess.endH
            ? d + sess.endH * 3600 * 1000
            : d + (sess.endH + 24) * 3600 * 1000;
          if (endMs < from || startMs > to) return;
          const a = ts.timeToCoordinate(Math.floor(Math.max(startMs, from) / 1000) as Time);
          const b = ts.timeToCoordinate(Math.floor(Math.min(endMs, to) / 1000) as Time);
          if (a == null || b == null) return;
          const left = Math.min(a, b);
          const width = Math.abs(b - a);
          if (width < 2) return;
          out.push({ key: `${d}-${sess.key}`, color: sess.color, label: sess.label, left, width, idx });
        });
      }
      setBands(out);
    };

    recompute();
    const ts = chart.timeScale();
    ts.subscribeVisibleTimeRangeChange(recompute);
    ts.subscribeVisibleLogicalRangeChange(recompute);
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      ts.unsubscribeVisibleTimeRangeChange(recompute);
      ts.unsubscribeVisibleLogicalRangeChange(recompute);
      ro.disconnect();
    };
  }, [sessions, ready, candles]);

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {/* Session bands overlay */}
      {sessions && bands.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {bands.map((b) => (
            <div
              key={b.key}
              className="absolute top-0 bottom-6"
              style={{ left: b.left, width: b.width, background: b.color, borderLeft: `1px dashed ${b.color.replace("0.08", "0.35")}`, borderRight: `1px dashed ${b.color.replace("0.08", "0.35")}` }}
            />
          ))}
        </div>
      )}
      <div className="absolute left-3 top-3 z-10 rounded-md border border-border bg-background/70 backdrop-blur px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <span>{isLive ? "Live" : showLoader ? "Loading" : "Native"} · {ticker} · {interval}</span>
        {isLive && (
          <span className="inline-flex items-center gap-1 text-emerald-400 normal-case">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {sourceLabel}
          </span>
        )}
        {enabled.OF && candles.length > 0 && (
          <span className={`inline-flex items-center gap-1 normal-case ${levels.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            Δ {levels.delta >= 0 ? "+" : ""}{levels.delta.toFixed(1)}
          </span>
        )}
      </div>
      {showLoader && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            Fetching live {ticker}…
          </div>
        </div>
      )}
      {sessions && (
        <div className="absolute right-3 top-3 z-10 rounded-md border border-border bg-background/70 backdrop-blur px-2 py-1 text-[10px] font-mono text-muted-foreground flex items-center gap-2">
          {SESSIONS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color.replace("0.08", "0.6") }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

