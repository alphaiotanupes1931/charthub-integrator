import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, Pencil, Minus as LineIcon, Square as RectIcon, ArrowUpRight, Undo2, Trash2,
  Eraser as EraserIcon, X as CloseIcon, MousePointer2, TrendingUp as TrendIcon, MoveUpRight,
  SeparatorVertical as VLineIcon, AlignHorizontalJustifyStart as FibIcon, Ruler as RulerIcon,
  Type as TypeIcon, Magnet as MagnetIcon, Lock, Unlock, Eye, EyeOff,
} from "lucide-react";
import { useCandleColors } from "@/hooks/useCandleColors";
import { useChartBackground } from "@/hooks/useChartBackground";
import { ChartReadabilityNotice } from "@/components/ChartReadabilityNotice";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CandlestickSeries,
  BarSeries,
  AreaSeries,
  BaselineSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type IPriceLine,
  LineStyle,
  LineType,
  CrosshairMode,
} from "lightweight-charts";
import { getCandleStyle, type CandleStyleId } from "@/lib/candleStyles";
import type { OhlcResponse } from "@/routes/api.ohlc";
import { useTimeFormat, formatTime } from "@/hooks/useTimeFormat";
import { useTimezone } from "@/hooks/useTimezone";
import { computeVwapIndicator, VWAP_COLORS } from "@/lib/vwapSignals";
import { computeFib } from "@/lib/fibLevels";
import { computeOrderBlocks, obLabel, OB_COLORS, type OrderBlock } from "@/lib/orderBlocks";
import { ChartSourceBadge, feedLabel } from "@/components/ChartSourceBadge";

export type LevelKey = "VWAP" | "POC" | "SR" | "ZONES" | "FVG" | "FIB" | "LIQ" | "OF" | "CISD" | "OB";

/** lightweight-charts parses colors itself and cannot read CSS variables. */
const BULL_COLOR = "#2dd4bf";


export const LEVEL_META: Record<LevelKey, { label: string; color: string; tone: string }> = {
  VWAP:  { label: "VWAP",  color: "#fbbf24", tone: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
  POC:   { label: "POC",   color: "#c084fc", tone: "bg-purple-500/10 text-purple-300 border-purple-500/30" },
  SR:    { label: "S/R",   color: "#38bdf8", tone: "bg-sky-500/10 text-sky-300 border-sky-500/30" },
  ZONES: { label: "Zones", color: "#60a5fa", tone: "bg-blue-500/10 text-blue-300 border-blue-500/30" },
  FVG:   { label: "FVG",   color: BULL_COLOR, tone: "bg-bull/10 text-bull border-bull/30" },
  FIB:   { label: "Fib",   color: "#f472b6", tone: "bg-pink-500/10 text-pink-300 border-pink-500/30" },
  LIQ:   { label: "Liq",   color: "#f87171", tone: "bg-red-500/10 text-red-300 border-red-500/30" },
  OF:    { label: "Order Flow", color: "#22d3ee", tone: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" },
  CISD:  { label: "CISD",  color: "#a3e635", tone: "bg-lime-500/10 text-lime-300 border-lime-500/30" },
  OB:    { label: "Order Blocks", color: "#2dd4bf", tone: "bg-teal-500/10 text-teal-300 border-teal-500/30" },
};

export type CisdInfo = {
  state: "bullish" | "bearish";
  level: number;        // the opposing-leg open that got broken
  trigger: number;      // close price that confirmed the flip
  proj1: number;        // 1x measured-move projection
  proj2: number;        // 2x extension
  legSize: number;
  htfBias: "bullish" | "bearish" | "neutral";
};

export type ChartSnapshot = {
  source: "coingecko" | "twelvedata" | "yahoo" | "oanda" | "stooq" | "backup" | "synthetic" | "unavailable";
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
  orderBlocks: { kind: "bullish" | "bearish"; top: number; bot: number; mitigated: boolean; strength: number }[];
  delta: number;
  sessionsActive: string[];
  cisd: CisdInfo | null;
  fetchedAt: string;
};

interface Props {
  symbol: string;
  ticker: string;
  interval: string; // 1, 5, 15, 60, 240, D, W, M
  enabled: Record<LevelKey, boolean>;
  sessions?: boolean;
  onSnapshot?: (snap: ChartSnapshot) => void;
  annotations?: import("@/lib/chartAnnotations").ChartAnnotation[];
  candleType?: CandleStyleId;
  className?: string;
}

// FX session windows in UTC (approximate, ignores DST).
// Rendered as translucent full-range boxes framing each session's high/low,
// mirroring TradingView's "Sessions" indicator seen in the reference chart.
const FX_SESSIONS = [
  { key: "Sydney",   startH: 22, endH: 7,  color: "rgba(56, 189, 248, 0.10)",  label: "Sydney"   },
  { key: "Tokyo",    startH: 0,  endH: 9,  color: "rgba(244, 114, 182, 0.10)", label: "Tokyo"    },
  { key: "London",   startH: 8,  endH: 17, color: "rgba(251, 191, 36, 0.10)",  label: "London"   },
  { key: "New York", startH: 13, endH: 22, color: "rgba(64, 160, 160, 0.10)",  label: "New York" },
];
// CME equity-index sessions in UTC (approximate).
// RTH cash: 09:30-16:00 ET => ~14:30-21:00 UTC. Globex: 18:00-09:30 ET prev day.
const INDEX_SESSIONS = [
  { key: "Globex",    startH: 23, endH: 14, color: "rgba(148, 163, 184, 0.08)", label: "Globex" },
  { key: "NY Open",   startH: 14, endH: 16, color: "rgba(251, 191, 36, 0.12)",  label: "NY Open" },
  { key: "RTH",       startH: 16, endH: 20, color: "rgba(64, 160, 160, 0.10)",  label: "RTH" },
  { key: "NY Close",  startH: 20, endH: 21, color: "rgba(244, 114, 182, 0.12)", label: "NY Close" },
];
function isIndexTicker(t?: string) {
  if (!t) return false;
  const s = t.toUpperCase();
  return /(\^N|\^G|\^D|NDX|NAS100|GSPC|SPX|SPX500|DJI|US30|^ES|^NQ|^YM)/.test(s);
}
const SESSIONS = FX_SESSIONS;
const getSessions = (ticker?: string) => (isIndexTicker(ticker) ? INDEX_SESSIONS : FX_SESSIONS);


type Candle = { time: Time; open: number; high: number; low: number; close: number };

function FallbackCandlestickLayer({ candles }: { candles: Candle[] }) {
  const recent = candles.slice(-140);
  if (recent.length < 2) return null;

  const minLow = Math.min(...recent.map((c) => c.low));
  const maxHigh = Math.max(...recent.map((c) => c.high));
  const range = Math.max(maxHigh - minLow, Math.abs(maxHigh) * 0.001, 1e-8);
  const topPrice = maxHigh + range * 0.08;
  const bottomPrice = minLow - range * 0.08;
  const priceRange = topPrice - bottomPrice;
  const left = 24;
  const right = 42;
  const top = 34;
  const bottom = 36;
  const width = 1000;
  const height = 600;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const step = plotW / Math.max(1, recent.length - 1);
  const bodyW = Math.max(3, Math.min(9, step * 0.58));
  const y = (price: number) => top + ((topPrice - price) / priceRange) * plotH;
  const x = (index: number) => left + index * step;
  const last = recent[recent.length - 1];
  const lastY = y(last.close);

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {[0.2, 0.4, 0.6, 0.8].map((p) => (
        <line key={p} x1={left} x2={width - right} y1={top + plotH * p} y2={top + plotH * p} stroke="rgba(148,163,184,0.10)" strokeWidth="1" />
      ))}
      {recent.map((c, i) => {
        const cx = x(i);
        const openY = y(c.open);
        const closeY = y(c.close);
        const highY = y(c.high);
        const lowY = y(c.low);
        const up = c.close >= c.open;
        const color = up ? BULL_COLOR : "#f87171";
        return (
          <g key={`${Number(c.time)}-${i}`}>
            <line x1={cx} x2={cx} y1={highY} y2={lowY} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity="0.9" />
            <rect
              x={cx - bodyW / 2}
              y={Math.min(openY, closeY)}
              width={bodyW}
              height={Math.max(2, Math.abs(closeY - openY))}
              rx="1"
              fill={up ? "rgba(52,211,153,0.78)" : "rgba(248,113,113,0.78)"}
              stroke={color}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      <line x1={left} x2={width - right} y1={lastY} y2={lastY} stroke="rgba(251,191,36,0.45)" strokeWidth="1" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// --- CISD (Change in State of Delivery) ---
// Detects the most recent flip where price closed through the origin open of the
// prior opposing delivery leg. Returns level, trigger, and 1x/2x measured-move projections.
function detectCisd(candles: Candle[]): Omit<CisdInfo, "htfBias"> | null {
  if (candles.length < 6) return null;
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
    const legLen = i - 1 - j;
    if (legLen < 2) continue;
    const flipped = isUp ? c.close > extreme : c.close < extreme;
    if (!flipped) continue;
    const legSize = Math.max(1e-9, hi - lo);
    const trigger = c.close;
    return {
      state: isUp ? "bullish" : "bearish",
      level: extreme,
      trigger,
      proj1: isUp ? trigger + legSize : trigger - legSize,
      proj2: isUp ? trigger + legSize * 2 : trigger - legSize * 2,
      legSize,
    };
  }
  return null;
}

// Aggregate candles into HTF groups (4x) and detect the CISD state there for bias.
function detectHtfBias(candles: Candle[]): "bullish" | "bearish" | "neutral" {
  if (candles.length < 20) return "neutral";
  const groupSize = 4;
  const agg: Candle[] = [];
  for (let i = 0; i + groupSize <= candles.length; i += groupSize) {
    const chunk = candles.slice(i, i + groupSize);
    agg.push({
      time: chunk[0].time,
      open: chunk[0].open,
      close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
    });
  }
  const htf = detectCisd(agg);
  return htf?.state ?? "neutral";
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
  // delta = sign(close-open) * |body|/range - strongest absorption/initiative bars
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

export function NativeChart({ symbol, ticker, interval, enabled, sessions, onSnapshot, annotations, candleType = "candle", className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const annLinesRef = useRef<IPriceLine[]>([]);
  const vwapSeriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const vwapMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [initAttempt, setInitAttempt] = useState(0);
  const [notPainted, setNotPainted] = useState(false);
  // Session band positions {key,color,label,left,width} in pixels for the overlay
  const [bands, setBands] = useState<Array<{ key: string; color: string; label: string; left: number; width: number; top: number; height: number; high: number; low: number; idx: number; vwap: Array<{ x: number; y: number }>; meanY: number | null; regX1: number; regY1: number; regX2: number; regY2: number }>>([]);
  // AI annotation zones projected into pixel coords for a shaded overlay
  const [annZones, setAnnZones] = useState<Array<{ key: string; top: number; height: number; color: string; label?: string }>>([]);
  // Order block boxes projected into pixel coords
  const [obBoxes, setObBoxes] = useState<Array<{ key: string; left: number; width: number; top: number; height: number; color: string; label: string; mitigated: boolean }>>([]);
  const { colors: candleColors } = useCandleColors();
  const { colors: chartBg } = useChartBackground();

  const { data: liveOhlc, isLoading, isError, refetch, isFetching } = useQuery<OhlcResponse>({
    queryKey: ["ohlc", ticker, interval],
    queryFn: async () => {
      const params = new URLSearchParams({ ticker, interval });
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const res = await fetch(`/api/ohlc?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`OHLC fetch failed: ${res.status}`);
        return (await res.json()) as OhlcResponse;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 2,
  });

  const hasLive = !!liveOhlc && !!liveOhlc.source && liveOhlc.bars.length > 0;
  const noLiveSource = isError || (!!liveOhlc && (!liveOhlc.source || liveOhlc.bars.length === 0));
  // Show the loader only while the first fetch is genuinely in flight.
  const showLoader = isLoading && !hasLive && !noLiveSource;

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
    return [];
  }, [liveOhlc, hasLive]);
  const levels = useMemo(() => computeLevels(candles), [candles]);
  // Fibonacci retracement is timeframe aware: swap the interval and the leg
  // being measured (and every level price) re-anchors to that timeframe.
  const fibStudy = useMemo(() => computeFib(candles, interval), [candles, interval]);
  const cisd = useMemo<CisdInfo | null>(() => {
    const base = detectCisd(candles);
    if (!base) return null;
    return { ...base, htfBias: detectHtfBias(candles) };
  }, [candles]);
  const orderBlocks = useMemo<OrderBlock[]>(
    () => computeOrderBlocks(candles.map((c) => ({ time: Number(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))),
    [candles],
  );
  const vwapIndicator = useMemo(
    () => computeVwapIndicator(candles.map((c) => ({ time: Number(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))),
    [candles],
  );
  const isLive = hasLive;
  const sourceLabel = isLive ? feedLabel(liveOhlc?.source) : "";
  const snapshotSource = isLive ? (liveOhlc?.source ?? "unknown") : "unavailable";
  const snapshotSourceLabel = isLive ? (sourceLabel || "Live") : "Unavailable";

  // Live clock for the on-chart overlay
  const { format: timeFormat } = useTimeFormat();
  const { resolvedTimezone } = useTimezone();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const activeSessionsNow = useMemo(() => {
    const h = now.getUTCHours();
    return getSessions(ticker).filter((s) => (s.startH < s.endH ? h >= s.startH && h < s.endH : h >= s.startH || h < s.endH)).map((s) => s.label);
  }, [now]);

  // Publish a snapshot to parent for AI context whenever the data changes
  useEffect(() => {
    if (!onSnapshot || candles.length === 0) return;
    const last20 = candles.slice(-20);
    const last50 = candles.slice(-50);
    const lastPrice = candles[candles.length - 1].close;
    const snap: ChartSnapshot = {
      source: snapshotSource as ChartSnapshot["source"],
      sourceLabel: snapshotSourceLabel,
      ticker,
      interval,
      lastPrice,
      high20: Math.max(...last20.map((c) => c.high)),
      low20:  Math.min(...last20.map((c) => c.low)),
      high50: Math.max(...last50.map((c) => c.high)),
      low50:  Math.min(...last50.map((c) => c.low)),
      vwap: levels.vwap,
      poc: levels.poc,
      sr: levels.sr,
      fib: (fibStudy?.levels ?? levels.fib).map((f) => ({ ratio: f.ratio, price: f.price })),
      liq: levels.liq,
      of: levels.of,
      orderBlocks: orderBlocks.map((b) => ({ kind: b.kind, top: b.top, bot: b.bot, mitigated: b.mitigated, strength: b.strength })),
      delta: levels.delta,
      sessionsActive: activeSessionsNow,
      cisd,
      fetchedAt: new Date().toISOString(),
    };
    onSnapshot(snap);
    // intentionally exclude onSnapshot identity from deps to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, levels, fibStudy, orderBlocks, ticker, interval, liveOhlc?.source, sourceLabel, activeSessionsNow]);

  // Time formatting is read through refs so changing the timezone (or 12/24h)
  // only re-applies axis options instead of tearing the chart down, which used
  // to leave a blank panel until the next data push.
  const tzRef = useRef<string | undefined>(resolvedTimezone);
  const hour12Ref = useRef<boolean>(timeFormat === "12h");
  tzRef.current = resolvedTimezone;
  hour12Ref.current = timeFormat === "12h";

  // Axis ticks: intraday shows the clock, but a tick that lands on a new day (or
  // any daily/weekly/monthly interval) shows the date. Without this a 1H chart
  // spanning a week printed "00:00" for every label with no date anywhere.
  const intervalRef = useRef<string>(interval);
  intervalRef.current = interval;
  const fmtTime = useCallback((t: number) => {
    const d = new Date(t * 1000);
    const tz = tzRef.current;
    const dateOnly = ["D", "W", "M", "240"].includes(intervalRef.current);
    const parts = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
    if (dateOnly || parts === "00:00") {
      return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", timeZone: tz });
    }
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: hour12Ref.current, timeZone: tz });
  }, []);
  const fmtDateTime = useCallback((t: number) => {
    const d = new Date(t * 1000);
    return d.toLocaleString(undefined, {
      month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: hour12Ref.current, timeZone: tzRef.current,
    });
  }, []);

  // Init / teardown chart.
  useEffect(() => {
    if (!containerRef.current) return;
    setInitError(null);

    let chart: IChartApi;
    let series: ISeriesApi<"Candlestick">;
    try {
      chart = createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { color: chartBg.bg },
          textColor: chartBg.text,
          fontFamily: "'Trebuchet MS', Roboto, Ubuntu, sans-serif",
          fontSize: 12,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: chartBg.grid, style: LineStyle.Solid },
          horzLines: { color: chartBg.grid, style: LineStyle.Solid },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "#758696", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#2962ff" },
          horzLine: { color: "#758696", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#2962ff" },
        },
        rightPriceScale: {
          borderColor: chartBg.border,
          borderVisible: true,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: chartBg.border,
          borderVisible: true,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 12,
          barSpacing: 6,
          tickMarkFormatter: (time: number) => fmtTime(time),
        },
        localization: {
          timeFormatter: (time: number) => fmtDateTime(time),
        },
      });
      const style = getCandleStyle(candleType);
      if (style.kind === "bar") {
        series = chart.addSeries(BarSeries, {
          upColor: candleColors.up, downColor: candleColors.down, thinBars: true,
        }) as unknown as ISeriesApi<"Candlestick">;
      } else if (style.kind === "line") {
        series = chart.addSeries(LineSeries, {
          color: candleColors.up,
          lineWidth: 2,
          lineType: style.stepped ? LineType.WithSteps : LineType.Simple,
          pointMarkersVisible: !!style.markers,
        }) as unknown as ISeriesApi<"Candlestick">;
      } else if (style.kind === "area") {
        series = chart.addSeries(AreaSeries, {
          lineColor: candleColors.up,
          topColor: `${candleColors.up}55`,
          bottomColor: `${candleColors.up}05`,
          lineWidth: 2,
        }) as unknown as ISeriesApi<"Candlestick">;
      } else if (style.kind === "baseline") {
        series = chart.addSeries(BaselineSeries, {
          topLineColor: candleColors.up,
          topFillColor1: `${candleColors.up}55`,
          topFillColor2: `${candleColors.up}05`,
          bottomLineColor: candleColors.down,
          bottomFillColor1: `${candleColors.down}05`,
          bottomFillColor2: `${candleColors.down}55`,
        }) as unknown as ISeriesApi<"Candlestick">;
      } else if (style.kind === "histogram") {
        series = chart.addSeries(HistogramSeries, {
          color: candleColors.up,
        }) as unknown as ISeriesApi<"Candlestick">;
      } else {
        series = chart.addSeries(CandlestickSeries, {
          upColor: style.hollow ? "rgba(0,0,0,0)" : candleColors.up,
          downColor: candleColors.down,
          borderUpColor: candleColors.borderUp, borderDownColor: candleColors.borderDown,
          wickUpColor: candleColors.wickUp, wickDownColor: candleColors.wickDown,
        });
      }
    } catch (err) {
      // Never leave a blank panel: fall back to the lightweight SVG renderer.
      setInitError(err instanceof Error ? err.message : "Chart engine failed to start");
      setReady(false);
      return;
    }
    chartRef.current = chart;
    seriesRef.current = series;
    setReady(true);
    return () => {
      linesRef.current = [];
      try { chart.remove(); } catch { /* ignore */ }
      chartRef.current = null;
      seriesRef.current = null;
      setReady(false);
    };
  }, [initAttempt, candleType, fmtTime, fmtDateTime]);

  // Timezone / clock-format change: re-apply the axis formatters in place so the
  // existing candles stay on screen.
  useEffect(() => {
    if (!ready || !chartRef.current) return;
    try {
      chartRef.current.applyOptions({
        timeScale: { tickMarkFormatter: (time: number) => fmtTime(time) },
        localization: { timeFormatter: (time: number) => fmtDateTime(time) },
      } as never);
    } catch { /* ignore */ }
  }, [ready, resolvedTimezone, timeFormat, interval, fmtTime, fmtDateTime]);



  // Apply live candle-color updates without recreating the chart
  useEffect(() => {
    if (!ready || !seriesRef.current) return;
    const style = getCandleStyle(candleType);
    if (style.kind !== "candlestick") return;
    seriesRef.current.applyOptions({
      upColor: style.hollow ? "rgba(0,0,0,0)" : candleColors.up,
      downColor: candleColors.down,
      borderUpColor: candleColors.borderUp, borderDownColor: candleColors.borderDown,
      wickUpColor: candleColors.wickUp, wickDownColor: candleColors.wickDown,
    });
  }, [ready, candleColors, candleType]);

  // Apply live chart-background updates without recreating the chart
  useEffect(() => {
    if (!ready || !chartRef.current) return;
    chartRef.current.applyOptions({
      layout: { background: { color: chartBg.bg }, textColor: chartBg.text },
      grid: {
        vertLines: { color: chartBg.grid },
        horzLines: { color: chartBg.grid },
      },
      rightPriceScale: { borderColor: chartBg.border },
      timeScale: { borderColor: chartBg.border },
    });
  }, [ready, chartBg]);

  // Transform raw bars into the selected display style (Heikin Ashi, Renko,
  // Kagi, line variants, ...). Value-based styles are also expressed as flat
  // candles so drawing/magnet/fallback logic keeps working.
  const styleData = useMemo(() => {
    const style = getCandleStyle(candleType);
    if (candles.length === 0) return { style, ohlc: [] as Candle[], values: [] as Array<{ time: number; value: number; color?: string }> };
    const raw = candles.map((c) => ({ time: Number(c.time), open: c.open, high: c.high, low: c.low, close: c.close }));
    if (style.ohlc) {
      const out = style.ohlc(raw);
      return { style, ohlc: out.map((p) => ({ ...p, time: p.time as Time })) as Candle[], values: [] };
    }
    const vals = (style.values?.(raw) ?? []).map((p, i, arr) => ({
      ...p,
      color: style.kind === "histogram"
        ? (i > 0 && p.value < arr[i - 1].value ? candleColors.down : candleColors.up)
        : undefined,
    }));
    return {
      style,
      ohlc: vals.map((p) => ({ time: p.time as Time, open: p.value, high: p.value, low: p.value, close: p.value })) as Candle[],
      values: vals,
    };
  }, [candles, candleType, candleColors]);

  const displayCandles = styleData.ohlc;

  // Push data in the shape the active series expects
  useEffect(() => {
    if (!ready || !seriesRef.current || !chartRef.current) return;
    try {
      const { style, ohlc, values } = styleData;
      if (style.kind === "candlestick" || style.kind === "bar") {
        seriesRef.current.setData(ohlc);
      } else {
        if (style.kind === "baseline" && values.length) {
          const base = values[0].value;
          seriesRef.current.applyOptions({ baseValue: { type: "price", price: base } } as never);
        }
        seriesRef.current.setData(values as never);
      }
      chartRef.current.timeScale().fitContent();
    } catch (err) {
      setInitError(err instanceof Error ? err.message : "Chart data could not be drawn");
    }
  }, [styleData, ready]);

  // Blank-panel guard: if we have candles but the canvas never got real pixels
  // (hidden container at mount, zero-size layout, engine hiccup), fall back to
  // the SVG renderer instead of showing an empty box.
  useEffect(() => {
    if (displayCandles.length === 0) { setNotPainted(false); return; }
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const host = containerRef.current;
      const canvas = host?.querySelector("canvas") as HTMLCanvasElement | null;
      const w = host?.clientWidth ?? 0;
      const h = host?.clientHeight ?? 0;
      const blank = !ready || !canvas || canvas.width < 2 || canvas.height < 2 || w < 2 || h < 2;
      setNotPainted(blank);
      if (blank && chartRef.current && w > 2 && h > 2) {
        // Nudge the engine to re-measure and redraw.
        try {
          chartRef.current.applyOptions({ autoSize: true });
          chartRef.current.timeScale().fitContent();
        } catch { /* ignore */ }
      }
    };
    const t1 = window.setTimeout(check, 900);
    const t2 = window.setTimeout(check, 2500);
    return () => { cancelled = true; window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [displayCandles, ready, initAttempt]);

  // ---- VWAP Buy/Sell indicator: VWAP + fast/slow MA + Buy/Sell/TP labels ----
  useEffect(() => {
    if (!ready || !chartRef.current || !seriesRef.current) return;
    const chart = chartRef.current;
    const cleanup = () => {
      vwapSeriesRef.current.forEach((sr) => { try { chart.removeSeries(sr); } catch { /* ignore */ } });
      vwapSeriesRef.current = [];
      if (vwapMarkersRef.current) { try { vwapMarkersRef.current.setMarkers([]); } catch { /* ignore */ } }
    };
    cleanup();
    if (!enabled.VWAP || vwapIndicator.vwap.length === 0) return;

    try {
      const mk = (data: { time: number; value: number }[], color: string, width: 1 | 2, dashed: boolean, title: string) => {
        const line = chart.addSeries(LineSeries, {
          color, lineWidth: width, title,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        line.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
        vwapSeriesRef.current.push(line);
      };
      mk(vwapIndicator.vwap, VWAP_COLORS.vwap, 2, false, "VWAP");
      mk(vwapIndicator.upper1, VWAP_COLORS.band, 1, false, "VWAP +1σ");
      mk(vwapIndicator.lower1, VWAP_COLORS.band, 1, false, "VWAP -1σ");
      mk(vwapIndicator.fast, VWAP_COLORS.fast, 2, false, "MA 21");
      mk(vwapIndicator.slow, VWAP_COLORS.slow, 2, false, "MA 50");

      vwapMarkersRef.current = createSeriesMarkers(
        seriesRef.current,
        vwapIndicator.signals.map((sig) => ({
          time: sig.time as Time,
          position: sig.kind === "sell" ? ("aboveBar" as const) : ("belowBar" as const),
          color: sig.kind === "buy" ? VWAP_COLORS.buy : sig.kind === "sell" ? VWAP_COLORS.sell : VWAP_COLORS.tp,
          shape: sig.kind === "buy" ? ("arrowUp" as const) : sig.kind === "sell" ? ("arrowDown" as const) : ("circle" as const),
          text: sig.kind === "buy" ? "Buy" : sig.kind === "sell" ? "Sell" : "TP",
        })),
      );
    } catch { /* indicator is decorative: never break the chart */ }

    return cleanup;
  }, [ready, enabled.VWAP, vwapIndicator]);

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
    if (enabled.FIB && fibStudy) {
      fibStudy.levels.forEach((f) => {
        const anchor = f.ratio === 0 || f.ratio === 1;
        const line = s.createPriceLine({
          price: f.price,
          color: f.color,
          lineWidth: 1,
          lineStyle: anchor ? LineStyle.Solid : f.ratio > 1 ? LineStyle.Dotted : LineStyle.Dashed,
          axisLabelVisible: true,
          title: f.label,
        });
        linesRef.current.push(line);
      });
    }
    if (enabled.LIQ) levels.liq.forEach((l) => add(l.price, LEVEL_META.LIQ.color, l.side === "buy" ? "Buy-side liq" : "Sell-side liq"));
    if (enabled.OF) levels.of.forEach((o, i) =>
      add(o.price, LEVEL_META.OF.color, `${o.side === "buy" ? "OF↑" : "OF↓"} ${i + 1}`, true),
    );
    if (enabled.CISD && cisd) {
      const arrow = cisd.state === "bullish" ? "↑" : "↓";
      add(cisd.level,   LEVEL_META.CISD.color, `CISD ${arrow} ${cisd.state}`);
      add(cisd.trigger, LEVEL_META.CISD.color, `CISD trigger`, true);
      add(cisd.proj1,   LEVEL_META.CISD.color, `CISD 1x → ${cisd.proj1.toFixed(2)}`, true);
      add(cisd.proj2,   LEVEL_META.CISD.color, `CISD 2x → ${cisd.proj2.toFixed(2)}`, true);
    }
  }, [enabled, levels, fibStudy, cisd, ready]);

  // ---- Sessions overlay ----
  useEffect(() => {
    if (!ready || !chartRef.current) { setBands([]); return; }
    if (!sessions) { setBands([]); return; }
    const chart = chartRef.current;

    const recompute = () => {
      const ts = chart.timeScale();
      const series = seriesRef.current;
      const visible = ts.getVisibleRange();
      if (!visible || !series) { setBands([]); return; }
      const from = Number(visible.from) * 1000;
      const to = Number(visible.to) * 1000;
      const DAY = 24 * 3600 * 1000;
      const out: Array<{ key: string; color: string; label: string; left: number; width: number; top: number; height: number; high: number; low: number; idx: number; vwap: Array<{ x: number; y: number }>; meanY: number | null; regX1: number; regY1: number; regX2: number; regY2: number }> = [];
      const firstDay = Math.floor(from / DAY) * DAY - DAY;
      for (let d = firstDay; d <= to; d += DAY) {
        getSessions(ticker).forEach((sess, idx) => {
          const startMs = d + sess.startH * 3600 * 1000;
          const endMs = sess.startH < sess.endH
            ? d + sess.endH * 3600 * 1000
            : d + (sess.endH + 24) * 3600 * 1000;
          if (endMs < from || startMs > to) return;
          // Collect candles within this session window
          const startSec = Math.floor(startMs / 1000);
          const endSec = Math.floor(endMs / 1000);
          let hi = -Infinity, lo = Infinity;
          const bars: Array<{ t: number; c: number; tp: number }> = [];
          for (const c of candles) {
            const t = Number(c.time);
            if (t >= startSec && t <= endSec) {
              if (c.high > hi) hi = c.high;
              if (c.low < lo) lo = c.low;
              bars.push({ t, c: c.close, tp: (c.high + c.low + c.close) / 3 });
            }
          }
          if (!isFinite(hi) || !isFinite(lo)) return;
          const a = ts.timeToCoordinate(Math.floor(Math.max(startMs, from) / 1000) as Time);
          const b = ts.timeToCoordinate(Math.floor(Math.min(endMs, to) / 1000) as Time);
          if (a == null || b == null) return;
          const left = Math.min(a, b);
          const width = Math.abs(b - a);
          if (width < 2) return;
          const yHi = series.priceToCoordinate(hi);
          const yLo = series.priceToCoordinate(lo);
          if (yHi == null || yLo == null) return;
          const top = Math.min(yHi, yLo);
          const height = Math.abs(yLo - yHi);

          // Cumulative VWAP (HLC/3 as volume proxy - no volume in feed)
          const vwapPts: Array<{ x: number; y: number }> = [];
          let cumNum = 0, cumDen = 0;
          let sumC = 0, sumCT = 0, n = 0;
          for (const bar of bars) {
            cumNum += bar.tp; cumDen += 1;
            const vw = cumNum / cumDen;
            const x = ts.timeToCoordinate(bar.t as Time);
            const y = series.priceToCoordinate(vw);
            if (x != null && y != null) vwapPts.push({ x, y });
            n += 1;
            sumC += bar.c;
            sumCT += bar.c * n;
          }
          let meanY: number | null = null;
          let regX1 = 0, regY1 = 0, regX2 = 0, regY2 = 0;
          if (bars.length >= 2) {
            const sma = sumC / n;
            const wma = sumCT / (n * (n + 1) / 2);
            const y1p = 4 * sma - 3 * wma;
            const y2p = 3 * wma - 2 * sma;
            const mY = series.priceToCoordinate(sma);
            if (mY != null) meanY = mY;
            const xa = ts.timeToCoordinate(bars[0].t as Time);
            const xb = ts.timeToCoordinate(bars[bars.length - 1].t as Time);
            const ya = series.priceToCoordinate(y1p);
            const yb = series.priceToCoordinate(y2p);
            if (xa != null && xb != null && ya != null && yb != null) {
              regX1 = xa; regY1 = ya; regX2 = xb; regY2 = yb;
            }
          }
          out.push({ key: `${d}-${sess.key}`, color: sess.color, label: sess.label, left, width, top, height, high: hi, low: lo, idx, vwap: vwapPts, meanY, regX1, regY1, regX2, regY2 });
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

  // ---- Order Blocks overlay (time-anchored boxes extending to mitigation) ----
  useEffect(() => {
    if (!ready || !chartRef.current || !seriesRef.current) { setObBoxes([]); return; }
    if (!enabled.OB || orderBlocks.length === 0) { setObBoxes([]); return; }
    const chart = chartRef.current;

    const recompute = () => {
      const series = seriesRef.current;
      if (!series) return;
      const ts = chart.timeScale();
      const width = containerRef.current?.clientWidth ?? 0;
      const out: Array<{ key: string; left: number; width: number; top: number; height: number; color: string; label: string; mitigated: boolean }> = [];
      orderBlocks.forEach((b, i) => {
        const yTop = series.priceToCoordinate(b.top);
        const yBot = series.priceToCoordinate(b.bot);
        if (yTop == null || yBot == null) return;
        const x1 = ts.timeToCoordinate(b.time as Time);
        const x2raw = b.mitigatedTime != null ? ts.timeToCoordinate(b.mitigatedTime as Time) : null;
        const left = x1 ?? 0;
        const right = x2raw != null ? x2raw : Math.max(width - 56, left + 8);
        out.push({
          key: `ob-${i}-${b.time}`,
          left,
          width: Math.max(6, right - left),
          top: Math.min(yTop, yBot),
          height: Math.max(3, Math.abs(yBot - yTop)),
          color: b.kind === "bullish" ? OB_COLORS.bullish : OB_COLORS.bearish,
          label: obLabel(b),
          mitigated: b.mitigated,
        });
      });
      setObBoxes(out);
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
  }, [ready, enabled.OB, orderBlocks, candles]);

  // ---- AI annotations (hlines / zones / labels) ----
  useEffect(() => {
    if (!ready || !seriesRef.current) { setAnnZones([]); return; }
    const s = seriesRef.current;
    // Clear previous AI lines
    annLinesRef.current.forEach((l) => { try { s.removePriceLine(l); } catch { /* ignore */ } });
    annLinesRef.current = [];
    if (!annotations || annotations.length === 0) { setAnnZones([]); return; }

    const push = (price: number, color: string, title: string, dashed = false) => {
      if (!isFinite(price)) return;
      try {
        const line = s.createPriceLine({
          price, color, lineWidth: 2,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true, title,
        });
        annLinesRef.current.push(line);
      } catch { /* ignore invalid prices */ }
    };

    annotations.forEach((a, i) => {
      if (a.kind === "hline") {
        push(a.price, a.color || "#fbbf24", a.label || `L${i + 1}`, !!a.dashed);
      } else if (a.kind === "label") {
        push(a.price, a.color || "#c084fc", a.text, true);
      } else if (a.kind === "zone") {
        const color = a.color || BULL_COLOR;
        push(a.top, color, `${a.label || "Zone"} ↑`, true);
        push(a.bottom, color, `${a.label || "Zone"} ↓`, true);
      }
    });

    // Build zone overlays with pixel coords
    const chart = chartRef.current;
    const recomputeZones = () => {
      if (!seriesRef.current || !chart) return;
      const out: Array<{ key: string; top: number; height: number; color: string; label?: string }> = [];
      annotations.forEach((a, i) => {
        if (a.kind !== "zone") return;
        const yTop = seriesRef.current!.priceToCoordinate(a.top);
        const yBot = seriesRef.current!.priceToCoordinate(a.bottom);
        if (yTop == null || yBot == null) return;
        const top = Math.min(yTop, yBot);
        const height = Math.max(2, Math.abs(yBot - yTop));
        out.push({ key: `ann-${i}`, top, height, color: a.color || BULL_COLOR, label: a.label });
      });
      setAnnZones(out);
    };
    recomputeZones();
    const ts = chart!.timeScale();
    ts.subscribeVisibleTimeRangeChange(recomputeZones);
    const ro = new ResizeObserver(recomputeZones);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      ts.unsubscribeVisibleTimeRangeChange(recomputeZones);
      ro.disconnect();
    };
  }, [annotations, ready, candles]);



  const handleScreenshot = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      const chartCanvas = chart.takeScreenshot();
      const out = document.createElement("canvas");
      out.width = chartCanvas.width;
      out.height = chartCanvas.height;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(chartCanvas, 0, 0);
      const draw = drawCanvasRef.current;
      if (draw && draw.width > 0 && draw.height > 0) {
        ctx.drawImage(draw, 0, 0, out.width, out.height);
      }
      const url = out.toDataURL("image/png");
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `${ticker.replace(/[^\w]+/g, "_")}_${interval}_${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error("screenshot failed", e);
    }
  }, [ticker, interval]);

  // ---- Drawing layer (TradingView-style tools, anchored to price/time) ----
  type DrawTool =
    | "cursor" | "pen" | "line" | "ray" | "hline" | "vline"
    | "rect" | "arrow" | "fib" | "measure" | "text" | "eraser";
  type Anchor = { l: number; p: number };            // logical bar index + price
  type Stroke = {
    tool: DrawTool;
    color: string;
    width: number;
    points: Anchor[];                                 // pen: many; others: [start, end]
    text?: string;
  };
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool>("line");
  const [drawColor, setDrawColor] = useState<string>("#fbbf24");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [magnet, setMagnet] = useState(true);
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);

  const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  const decimals = useCallback((v: number) => (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 10 ? 3 : 5), []);

  // screen <-> chart coordinate helpers
  const toAnchor = useCallback((x: number, y: number): Anchor | null => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const l = chart.timeScale().coordinateToLogical(x);
    const p = series.coordinateToPrice(y);
    if (l == null || p == null) return null;
    return { l: l as number, p: p as number };
  }, []);
  const toScreen = useCallback((a: Anchor): { x: number; y: number } | null => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().logicalToCoordinate(a.l as never);
    const y = series.priceToCoordinate(a.p);
    if (x == null || y == null) return null;
    return { x: x as number, y: y as number };
  }, []);
  // magnet: snap the price to the nearest OHLC of the bar under the cursor
  const snapAnchor = useCallback((a: Anchor): Anchor => {
    if (!magnet) return a;
    const idx = Math.round(a.l);
    const c = displayCandles[idx];
    if (!c) return a;
    const cands = [c.open, c.high, c.low, c.close];
    let best = a.p, bestD = Infinity;
    for (const v of cands) {
      const d = Math.abs(v - a.p);
      if (d < bestD) { bestD = d; best = v; }
    }
    // only snap when reasonably close (within 35% of the bar range)
    const range = Math.max(1e-9, c.high - c.low);
    if (bestD > range * 0.35) return a;
    return { l: idx, p: best };
  }, [magnet, displayCandles]);

  const redraw = useCallback(() => {
    const cvs = drawCanvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cvs.width / dpr, cssH = cvs.height / dpr;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const all = currentStrokeRef.current ? [...strokes, currentStrokeRef.current] : strokes;
    for (const s of all) {
      if (!s || !Array.isArray(s.points)) continue;
      const pts = s.points.map(toScreen).filter(Boolean) as { x: number; y: number }[];
      if (pts.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const a = pts[0], b = pts[pts.length - 1];
      const priceOf = (i: number) => s.points[i]?.p ?? 0;
      if (s.tool === "pen") {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      } else if (s.tool === "text") {
        ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(s.text || "", a.x, a.y);
      } else if (s.tool === "hline") {
        ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(cssW, a.y); ctx.stroke();
        ctx.fillText(priceOf(0).toFixed(decimals(priceOf(0))), drawMode ? 46 : 8, a.y - 4);
      } else if (s.tool === "vline") {
        ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, cssH); ctx.stroke();
      } else if (pts.length >= 2) {
        if (s.tool === "line") {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        } else if (s.tool === "ray") {
          const dx = b.x - a.x, dy = b.y - a.y;
          const k = 4000 / Math.max(1, Math.hypot(dx, dy));
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + dx * k, a.y + dy * k); ctx.stroke();
        } else if (s.tool === "rect") {
          ctx.globalAlpha = 0.12;
          ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.globalAlpha = 1;
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        } else if (s.tool === "arrow") {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const head = 10 + s.width * 2;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 7), b.y - head * Math.sin(angle - Math.PI / 7));
          ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 7), b.y - head * Math.sin(angle + Math.PI / 7));
          ctx.closePath();
          ctx.fill();
        } else if (s.tool === "fib") {
          const p0 = s.points[0].p, p1 = s.points[s.points.length - 1].p;
          const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
          const d = decimals(p0);
          FIB_RATIOS.forEach((r) => {
            const price = p0 + (p1 - p0) * r;
            const sc = toScreen({ l: s.points[0].l, p: price });
            if (!sc) return;
            ctx.setLineDash(r === 0 || r === 1 ? [] : [4, 4]);
            ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.moveTo(x1, sc.y); ctx.lineTo(Math.max(x2, x1 + 60), sc.y); ctx.stroke();
            ctx.fillText(`${r} · ${price.toFixed(d)}`, x1 + 4, sc.y - 3);
          });
          ctx.setLineDash([]);
        } else if (s.tool === "measure") {
          const p0 = s.points[0].p, p1 = s.points[s.points.length - 1].p;
          const bars = Math.abs(Math.round(s.points[s.points.length - 1].l - s.points[0].l));
          const diff = p1 - p0;
          const pct = p0 !== 0 ? (diff / p0) * 100 : 0;
          const up = diff >= 0;
          ctx.strokeStyle = up ? "#2dd4bf" : "#f87171";
          ctx.fillStyle = up ? "#2dd4bf" : "#f87171";
          ctx.globalAlpha = 0.14;
          ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.globalAlpha = 1;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
          ctx.setLineDash([]);
          const label = `${up ? "+" : ""}${diff.toFixed(decimals(p0))} (${pct.toFixed(2)}%) · ${bars} bars`;
          const tw = ctx.measureText(label).width;
          const lx = Math.min(cssW - tw - 10, (a.x + b.x) / 2 - tw / 2);
          const ly = b.y + (up ? -8 : 16);
          ctx.fillText(label, Math.max(4, lx), ly);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }, [strokes, hidden, toScreen, decimals, drawMode]);

  // Size canvas to container and repaint on resize / pan / zoom
  useEffect(() => {
    const cvs = drawCanvasRef.current;
    const host = containerRef.current;
    if (!cvs || !host) return;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cvs.width = Math.max(1, Math.floor(rect.width * dpr));
      cvs.height = Math.max(1, Math.floor(rect.height * dpr));
      cvs.style.width = `${rect.width}px`;
      cvs.style.height = `${rect.height}px`;
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const chart = chartRef.current;
    const ts = chart?.timeScale();
    ts?.subscribeVisibleLogicalRangeChange(redraw);
    ts?.subscribeVisibleTimeRangeChange(redraw);
    return () => {
      ro.disconnect();
      ts?.unsubscribeVisibleLogicalRangeChange(redraw);
      ts?.unsubscribeVisibleTimeRangeChange(redraw);
    };
  }, [redraw, ready]);

  useEffect(() => { redraw(); }, [strokes, redraw]);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cvs = drawCanvasRef.current!;
    const rect = cvs.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Distance from point p to segment ab (in canvas CSS px).
  const distToSegment = (p: {x:number;y:number}, a: {x:number;y:number}, b: {x:number;y:number}) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t*dx), p.y - (a.y + t*dy));
  };
  const strokeHitTest = (s: Stroke, p: {x:number;y:number}, tol: number) => {
    const pts = s.points.map(toScreen).filter(Boolean) as { x: number; y: number }[];
    if (pts.length === 0) return false;
    const a = pts[0], b = pts[pts.length - 1];
    if (s.tool === "pen") {
      for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i-1], pts[i]) <= tol) return true;
      return false;
    }
    if (s.tool === "text") return Math.hypot(p.x - a.x, p.y - a.y) <= 24;
    if (s.tool === "hline") return Math.abs(p.y - a.y) <= tol;
    if (s.tool === "vline") return Math.abs(p.x - a.x) <= tol;
    if (pts.length < 2) return false;
    if (s.tool === "line" || s.tool === "arrow" || s.tool === "ray") return distToSegment(p, a, b) <= tol;
    // rect / fib / measure: any edge of the bounding box
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    if (s.tool === "fib") return p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
    const edges: Array<[{x:number;y:number},{x:number;y:number}]> = [
      [{x:x1,y:y1},{x:x2,y:y1}], [{x:x2,y:y1},{x:x2,y:y2}],
      [{x:x2,y:y2},{x:x1,y:y2}], [{x:x1,y:y2},{x:x1,y:y1}],
    ];
    return edges.some(([e1, e2]) => distToSegment(p, e1, e2) <= tol);
  };
  const eraseAt = (p: {x:number;y:number}) => {
    setStrokes((prev) => prev.filter((s) => !strokeHitTest(s, p, 10)));
  };

  const interactive = drawMode && !locked && !hidden && drawTool !== "cursor";

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const sp = getPoint(e);
    if (drawTool === "eraser") { drawingRef.current = true; eraseAt(sp); return; }
    const raw = toAnchor(sp.x, sp.y);
    if (!raw) return;
    const anchor = drawTool === "pen" || drawTool === "text" ? raw : snapAnchor(raw);
    if (drawTool === "text") {
      const text = window.prompt("Text label");
      if (text) setStrokes((prev) => [...prev, { tool: "text", color: drawColor, width: 2, points: [anchor], text }]);
      return;
    }
    const fresh: Stroke = { tool: drawTool, color: drawColor, width: 2, points: [anchor] };
    if (drawTool === "hline" || drawTool === "vline") {
      setStrokes((prev) => [...prev, fresh]);
      return;
    }
    drawingRef.current = true;
    currentStrokeRef.current = fresh;
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || !drawingRef.current) return;
    const sp = getPoint(e);
    if (drawTool === "eraser") { eraseAt(sp); return; }
    const raw = toAnchor(sp.x, sp.y);
    if (!raw || !currentStrokeRef.current) return;
    const s = currentStrokeRef.current;
    if (s.tool === "pen") s.points.push(raw);
    else s.points = [s.points[0], snapAnchor(raw)];
    redraw();
  };
  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const s = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (s && s.points.length > 0) setStrokes((prev) => [...prev, s]);
    else redraw();
  };

  const undoStroke = () => setStrokes((prev) => prev.slice(0, -1));
  const clearStrokes = () => setStrokes([]);

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {(initError || notPainted) && displayCandles.length > 0 && (
        <>
          <FallbackCandlestickLayer candles={displayCandles} />
          <button
            type="button"
            onClick={() => { setInitError(null); setNotPainted(false); setInitAttempt((n) => n + 1); }}
            className="absolute right-2 bottom-10 z-20 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur hover:text-foreground"
          >
            Reload chart
          </button>
        </>
      )}
      {/* Session bands overlay */}
      {sessions && bands.length > 0 && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {bands.map((b) => {
            const border = b.color.replace("0.10", "0.65");
            const fill = b.color.replace("0.10", "0.18");
            const labelTop = -4 - b.idx * 12;
            return (
              <div
                key={b.key}
                className="absolute"
                style={{ left: b.left, width: b.width, top: b.top, height: Math.max(2, b.height), background: fill, border: `1px solid ${border}`, borderRadius: 2, boxShadow: `inset 0 0 0 9999px ${fill}` }}
              >
                <span
                  className="absolute left-1 text-[9px] font-mono tracking-tight whitespace-nowrap"
                  style={{ top: labelTop, color: border }}
                >
                  {b.label} · H {b.high.toFixed(2)} · L {b.low.toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* Session VWAP / mean / regression lines */}
      {sessions && bands.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          {bands.map((b) => {
            const stroke = b.color.replace("0.10", "0.9");
            const meanStroke = b.color.replace("0.10", "0.7");
            const poly = b.vwap.length >= 2 ? b.vwap.map((p) => `${p.x},${p.y}`).join(" ") : "";
            return (
              <g key={`ln-${b.key}`}>
                {poly && (
                  <polyline points={poly} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="3 2" />
                )}
                {b.meanY != null && (
                  <line x1={b.left} y1={b.meanY} x2={b.left + b.width} y2={b.meanY} stroke={meanStroke} strokeWidth={1} strokeDasharray="1 3" />
                )}
                {b.regX2 > b.regX1 && (
                  <line x1={b.regX1} y1={b.regY1} x2={b.regX2} y2={b.regY2} stroke={stroke} strokeWidth={1.25} />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {/* Order block boxes */}
      {obBoxes.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
          {obBoxes.map((b) => (
            <div
              key={b.key}
              className="absolute"
              style={{
                left: b.left,
                width: b.width,
                top: b.top,
                height: b.height,
                background: b.mitigated ? `${b.color}14` : `${b.color}2e`,
                border: `1px ${b.mitigated ? "dashed" : "solid"} ${b.color}${b.mitigated ? "66" : "aa"}`,
                borderRadius: 2,
              }}
            >
              <span
                className="absolute left-1 -top-3.5 text-[9px] font-mono tracking-tight whitespace-nowrap"
                style={{ color: b.color, opacity: b.mitigated ? 0.6 : 1 }}
              >
                {b.label}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* AI annotation zones (shaded) */}
      {annZones.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0" style={{ top: 0, bottom: 0 }}>
          {annZones.map((z) => (
            <div
              key={z.key}
              className="absolute left-0 right-14"
              style={{ top: z.top, height: z.height, background: `${z.color}22`, border: `1px dashed ${z.color}` }}
            >
              {z.label && (
                <span
                  className="absolute -top-4 left-1 text-[9px] font-mono tracking-tight whitespace-nowrap"
                  style={{ color: z.color }}
                >
                  {z.label}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="absolute left-2 top-2 sm:left-3 sm:top-3 z-10 max-w-[55%] rounded-xl border border-border/60 bg-background/70 backdrop-blur px-1.5 py-1 sm:px-2 text-[9px] sm:text-[10px] font-mono text-muted-foreground tracking-tight flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="truncate">{isLive ? "Live" : showLoader ? "Loading" : noLiveSource ? "Unavailable" : "Native"} · {ticker} · {interval}</span>
        <ChartSourceBadge
          live={isLive}
          label={isLive ? sourceLabel : showLoader ? "Connecting" : feedLabel(liveOhlc?.source)}
          className="border-0 bg-transparent px-0 py-0"
        />
        {enabled.OF && candles.length > 0 && (
          <span className={`inline-flex items-center gap-1 normal-case ${levels.delta >= 0 ? "text-bull" : "text-red-400"}`}>
            Δ {levels.delta >= 0 ? "+" : ""}{levels.delta.toFixed(1)}
          </span>
        )}
        {enabled.CISD && cisd && (
          <span className={`inline-flex items-center gap-1 normal-case ${cisd.state === "bullish" ? "text-lime-300" : "text-red-300"}`}>
            CISD {cisd.state === "bullish" ? "↑" : "↓"} · HTF {cisd.htfBias}
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
      {noLiveSource && !showLoader && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm animate-fade-in">
          <div className="max-w-xs text-center text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Live chart data not loading</p>
            <p>We can’t reach the {ticker} feed right now. Check your connection, then retry.</p>
            <button
              type="button"
              onClick={() => { void refetch(); }}
              className="mt-3 rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors duration-200 hover:bg-muted"
            >
              {isFetching ? "Retrying…" : "Retry"}
            </button>
          </div>
        </div>
      )}

      {/* Live clock: local + UTC, honours 12h/24h preference */}
      <div className="absolute right-2 top-2 sm:right-3 sm:top-3 z-10 max-w-[42%] rounded-xl border border-border/60 bg-background/70 backdrop-blur px-1.5 py-1 sm:px-2 text-[9px] sm:text-[10px] font-mono text-muted-foreground flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
        <span className="text-foreground/90">{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: timeFormat === "12h", timeZone: resolvedTimezone })}</span>
        <span className="hidden sm:inline opacity-60">·</span>
        <span className="hidden sm:inline">{formatTime(now, timeFormat, { seconds: false, utc: true })} UTC</span>
        {activeSessionsNow.length > 0 && (
          <>
            <span className="hidden sm:inline opacity-60">·</span>
            <span className="hidden sm:inline text-primary normal-case">{activeSessionsNow.join(" + ")}</span>
          </>
        )}
      </div>
      {/* Drawing overlay canvas (top of stack, only captures input when drawMode is on) */}
      <canvas
        ref={drawCanvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute inset-0 z-30"
        style={{
          pointerEvents: interactive ? "auto" : "none",
          cursor: interactive ? "crosshair" : "default",
          touchAction: interactive ? "none" : "auto",
        }}
      />

      {/* TradingView-style tool rail: always pinned to the left of the chart.
          Picking any tool other than the cursor turns drawing on. */}
      {!hidden && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 sm:left-2 z-40 flex max-h-[92%] flex-col items-center gap-0.5 overflow-y-auto rounded-xl border border-border/60 bg-background/95 backdrop-blur px-1 py-1.5 shadow-lg">
          {([
            { k: "cursor", Icon: MousePointer2, label: "Cursor (pan chart)" },
            { k: "line", Icon: TrendIcon, label: "Trend line" },
            { k: "ray", Icon: MoveUpRight, label: "Ray" },
            { k: "hline", Icon: LineIcon, label: "Horizontal line" },
            { k: "vline", Icon: VLineIcon, label: "Vertical line" },
            { k: "rect", Icon: RectIcon, label: "Rectangle / zone" },
            { k: "arrow", Icon: ArrowUpRight, label: "Arrow" },
            { k: "fib", Icon: FibIcon, label: "Fib retracement" },
            { k: "measure", Icon: RulerIcon, label: "Measure (price / % / bars)" },
            { k: "text", Icon: TypeIcon, label: "Text label" },
            { k: "pen", Icon: Pencil, label: "Brush" },
            { k: "eraser", Icon: EraserIcon, label: "Eraser" },
          ] as { k: DrawTool; Icon: typeof Pencil; label: string }[]).map(({ k, Icon, label }) => (
            <button
              key={k}
              type="button"
              onClick={() => setDrawTool(k)}
              title={label}
              aria-label={label}
              className={`inline-flex items-center justify-center rounded p-1.5 transition ${drawTool === k ? "bg-primary/20 text-primary" : "text-foreground/80 hover:bg-muted"}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <span className="my-0.5 h-px w-5 bg-border" />
          <button
            type="button"
            onClick={() => setMagnet((v) => !v)}
            title={magnet ? "Magnet on (snap to OHLC)" : "Magnet off"}
            aria-label="Toggle magnet"
            className={`inline-flex items-center justify-center rounded p-1.5 transition ${magnet ? "bg-primary/20 text-primary" : "text-foreground/70 hover:bg-muted"}`}
          >
            <MagnetIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setLocked((v) => !v)}
            title={locked ? "Drawings locked" : "Lock drawings"}
            aria-label="Toggle lock"
            className={`inline-flex items-center justify-center rounded p-1.5 transition ${locked ? "bg-primary/20 text-primary" : "text-foreground/70 hover:bg-muted"}`}
          >
            {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setHidden((v) => !v)}
            title={hidden ? "Show drawings" : "Hide drawings"}
            aria-label="Toggle drawing visibility"
            className={`inline-flex items-center justify-center rounded p-1.5 transition ${hidden ? "bg-primary/20 text-primary" : "text-foreground/70 hover:bg-muted"}`}
          >
            {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <span className="my-0.5 h-px w-5 bg-border" />
          <div className="flex flex-col items-center gap-1 py-0.5">
            {["#fbbf24", "#22d3ee", "#f87171", "#a3e635", "#ffffff"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDrawColor(c)}
                title={c}
                aria-label={`Color ${c}`}
                className={`h-3.5 w-3.5 rounded-full border ${drawColor === c ? "border-foreground scale-110" : "border-border/60"} transition`}
                style={{ background: c }}
              />
            ))}
          </div>
          <span className="my-0.5 h-px w-5 bg-border" />
          <button type="button" onClick={undoStroke} title="Undo" aria-label="Undo" className="rounded p-1.5 text-foreground/80 hover:bg-muted">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={clearStrokes} title="Remove all drawings" aria-label="Remove all drawings" className="rounded p-1.5 text-foreground/80 hover:bg-muted">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="absolute right-2 bottom-2 sm:right-3 sm:bottom-3 z-40 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDrawMode((v) => !v)}
          title={drawMode ? "Exit draw mode" : "Draw on chart"}
          aria-label={drawMode ? "Exit draw mode" : "Draw on chart"}
          className={`inline-flex items-center gap-1.5 rounded-xl border backdrop-blur px-2 py-1.5 text-[10px] font-mono tracking-tight transition-colors ${
            drawMode
              ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20"
              : "border-border/60 bg-background/80 hover:bg-background text-foreground/90 hover:text-foreground"
          }`}
        >
          {drawMode ? <CloseIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{drawMode ? "Done" : "Draw"}</span>
        </button>
        <button
          type="button"
          onClick={handleScreenshot}
          title="Save chart screenshot"
          aria-label="Save chart screenshot"
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-background/80 hover:bg-background backdrop-blur px-2 py-1.5 text-[10px] font-mono tracking-tight text-foreground/90 hover:text-foreground transition-colors"
        >
          <Camera className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Save</span>
        </button>
      </div>
      {sessions && (
        <div className="absolute right-2 top-11 sm:right-3 sm:top-12 z-10 max-w-[60%] rounded-xl border border-border/60 bg-background/70 backdrop-blur px-1.5 py-1 sm:px-2 text-[9px] sm:text-[10px] font-mono text-muted-foreground flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
          {getSessions(ticker).map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-lg shrink-0" style={{ background: s.color.replace("0.10", "0.7") }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {enabled.OF && candles.length > 0 && (
        <div className="absolute left-2 bottom-2 sm:left-3 sm:bottom-3 z-10 max-w-[min(34rem,calc(100%-1rem))] rounded-xl border border-border/60 bg-background/80 backdrop-blur px-2 py-1.5 text-[10px] font-mono text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold tracking-tight text-foreground/90">Order flow</span>
            <span className={levels.delta >= 0 ? "text-bull" : "text-red-300"}>
              Delta {levels.delta >= 0 ? "+" : ""}{levels.delta.toFixed(1)}
            </span>
            {levels.of.slice(0, 3).map((o, i) => (
              <span key={`${o.side}-${o.price}-${i}`} className={o.side === "buy" ? "text-bull" : "text-red-300"}>
                {o.side === "buy" ? "Buy" : "Sell"} {o.strength >= 0.72 ? "high" : "med"} @ {o.price.toFixed(o.price >= 1000 ? 2 : 4)}
              </span>
            ))}
            <span>Volume proxy {Math.abs(levels.delta) >= 12 ? "high" : Math.abs(levels.delta) >= 6 ? "medium" : "light"}</span>
          </div>
        </div>
      )}
      <ChartReadabilityNotice className="absolute bottom-2 left-1/2 z-30 max-w-[min(24rem,calc(100%-1rem))] -translate-x-1/2" />
    </div>
  );
}

