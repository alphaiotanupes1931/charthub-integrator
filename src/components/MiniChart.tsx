import { useMemo } from "react";

interface Props {
  symbol: string;
  width?: string | number;
  height?: number;
  dateRange?: string;
}

/**
 * Demo sparkline for the public landing page.
 * Renders a deterministic synthetic price line - no network, no live data.
 */
function seededSeries(seed: string, points = 48) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const rand = () => {
    h = (h * 1664525 + 1013904223) | 0;
    return ((h >>> 0) % 10000) / 10000;
  };
  const values: number[] = [];
  let v = 50 + rand() * 30;
  for (let i = 0; i < points; i++) {
    v += (rand() - 0.48) * 4;
    values.push(v);
  }
  return values;
}

function Sparkline({ seed, height }: { seed: string; height: number }) {
  const { path, area, up } = useMemo(() => {
    const values = seededSeries(seed);
    const w = 200;
    const h = height;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = w / (values.length - 1);
    const pts = values.map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return [x, y] as const;
    });
    const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const area = `${path} L${w},${h} L0,${h} Z`;
    const up = pts[pts.length - 1][1] < pts[0][1];
    return { path, area, up };
  }, [seed, height]);

  const stroke = up ? "rgba(201, 168, 76, 1)" : "rgba(201, 168, 76, 1)";
  const fill = "rgba(201, 168, 76, 0.18)";

  return (
    <svg viewBox={`0 0 200 ${height}`} preserveAspectRatio="none" className="w-full h-full block">
      <path d={area} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MiniChart({ symbol, width = "100%", height = 70 }: Props) {
  return (
    <div className="rounded-md overflow-hidden bg-transparent" style={{ width, height }}>
      <Sparkline seed={symbol} height={height} />
    </div>
  );
}

interface SymbolOverviewProps {
  symbol: string;
  height?: number;
}

export function SymbolOverview({ symbol, height = 320 }: SymbolOverviewProps) {
  const label = symbol.split(":").pop() ?? symbol;
  const values = useMemo(() => seededSeries(symbol, 80), [symbol]);
  const last = values[values.length - 1];
  const first = values[0];
  const changePct = ((last - first) / first) * 100;
  const up = changePct >= 0;

  return (
    <div
      className="rounded-lg overflow-hidden bg-transparent border border-border/40 p-4 flex flex-col"
      style={{ width: "100%", height }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
          <div className="font-display text-2xl mt-1">{last.toFixed(2)}</div>
        </div>
        <div className={`font-mono text-sm ${up ? "text-emerald-400" : "text-destructive"}`}>
          {up ? "+" : ""}
          {changePct.toFixed(2)}%
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Sparkline seed={symbol + "-overview"} height={height - 90} />
      </div>
      <div className="flex items-center justify-between mt-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        <span>1D</span>
        <span>1W</span>
        <span>1M</span>
        <span>3M</span>
        <span>1Y</span>
        <span>ALL</span>
      </div>
    </div>
  );
}
