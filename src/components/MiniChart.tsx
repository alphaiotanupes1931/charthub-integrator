import { useMemo } from "react";

interface Props {
  symbol: string;
  width?: string | number;
  height?: number;
  dateRange?: string;
}

// Deterministic pseudo-random series from a string seed so each symbol gets a stable shape.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeSeries(seed: number, points: number, volatility = 1) {
  let s = seed || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
  const vals: number[] = [];
  let v = 50;
  for (let i = 0; i < points; i++) {
    v += (rand() - 0.48) * 6 * volatility;
    vals.push(v);
  }
  // normalize 0..1
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return vals.map((x) => (x - min) / span);
}

function FakeChart({
  symbol,
  height,
  showAxis = false,
  volatility = 1,
  points = 80,
}: {
  symbol: string;
  height: number;
  showAxis?: boolean;
  volatility?: number;
  points?: number;
}) {
  const { path, area, last, first, gradId } = useMemo(() => {
    const seed = hashSeed(symbol);
    const series = makeSeries(seed, points, volatility);
    const w = 600;
    const h = 100;
    const step = w / (series.length - 1);
    const toY = (v: number) => h - 8 - v * (h - 16);
    const pts = series.map((v, i) => [i * step, toY(v)] as const);
    const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `${path} L${w},${h} L0,${h} Z`;
    const gradId = `g_${seed.toString(36)}`;
    return { path, area, last: series[series.length - 1], first: series[0], gradId };
  }, [symbol, points, volatility]);

  const up = last >= first;
  const stroke = up ? "rgb(201, 168, 76)" : "rgb(220, 120, 90)";

  return (
    <svg
      viewBox="0 0 600 100"
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className="block"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showAxis && (
        <g stroke="rgba(180,140,60,0.08)" strokeWidth="0.5">
          <line x1="0" y1="25" x2="600" y2="25" />
          <line x1="0" y1="50" x2="600" y2="50" />
          <line x1="0" y1="75" x2="600" y2="75" />
        </g>
      )}
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MiniChart({ symbol, width = "100%", height = 70 }: Props) {
  return (
    <div
      className="rounded-md overflow-hidden bg-transparent"
      style={{ width, height }}
    >
      <FakeChart symbol={symbol} height={height} points={60} volatility={1.1} />
    </div>
  );
}

interface SymbolOverviewProps {
  symbol: string;
  height?: number;
}

const SYMBOL_META: Record<string, { label: string; price: string; change: string; pct: string; up: boolean }> = {
  "OANDA:XAUUSD": { label: "Gold Spot / U.S. Dollar", price: "4,191.205", change: "+12.85", pct: "+0.31%", up: true },
  "BINANCE:BTCUSDT": { label: "Bitcoin / Tether", price: "98,420.50", change: "+1,240.20", pct: "+1.28%", up: true },
  "FOREXCOM:NSXUSD": { label: "Nasdaq 100", price: "21,847.30", change: "-42.10", pct: "-0.19%", up: false },
  "FOREXCOM:SPXUSD": { label: "S&P 500", price: "6,124.80", change: "+8.42", pct: "+0.14%", up: true },
  "FOREXCOM:DJI": { label: "Dow Jones", price: "44,892.10", change: "+115.20", pct: "+0.26%", up: true },
  "FX:EURUSD": { label: "EUR / USD", price: "1.0584", change: "+0.0021", pct: "+0.20%", up: true },
};

export function SymbolOverview({ symbol, height = 320 }: SymbolOverviewProps) {
  const meta = SYMBOL_META[symbol] ?? { label: symbol, price: "—", change: "0.00", pct: "0.00%", up: true };
  const ranges = ["1D", "1W", "1M", "3M", "1Y", "All"];

  return (
    <div
      className="rounded-lg overflow-hidden bg-transparent border border-border/40 p-4 sm:p-5"
      style={{ width: "100%", height }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm text-muted-foreground">{meta.label}</div>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-display text-2xl sm:text-3xl text-foreground">{meta.price}</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">USD</span>
            <span className={`text-sm font-mono ${meta.up ? "text-emerald-400" : "text-destructive"}`}>
              {meta.change} {meta.pct}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] font-mono">
          {ranges.map((r, i) => (
            <span
              key={r}
              className={`px-2 py-1 rounded ${
                i === 0
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground"
              }`}
            >
              {r}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4" style={{ height: Math.max(120, height - 110) }}>
        <FakeChart symbol={symbol} height={Math.max(120, height - 110)} showAxis points={120} volatility={1.3} />
      </div>
    </div>
  );
}
