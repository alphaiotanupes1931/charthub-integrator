// Visual replay of a historical backtest: the actual candles the engine ran on,
// with every simulated entry and exit marked, and a stepper that zooms the chart
// to one trade at a time with its entry, stop and target drawn as price lines.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineStyle,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type Time,
} from "lightweight-charts";
import { ChevronLeft, ChevronRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BtBar, BtResult, BtTrade } from "@/lib/backtest/engine";

type Props = { bars: BtBar[]; result: BtResult };

function fmt(t: number) {
  return new Date(t * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BacktestReplay({ bars, result }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const [index, setIndex] = useState(0);

  const trades = result.trades;
  const trade: BtTrade | undefined = trades[index];

  const candles = useMemo(
    () =>
      bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    [bars],
  );

  // Build the chart once.
  useEffect(() => {
    if (!holder.current) return;
    const chart = createChart(holder.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "hsl(215 16% 65%)",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(120,130,145,0.12)" },
        horzLines: { color: "rgba(120,130,145,0.12)" },
      },
      rightPriceScale: { borderColor: "rgba(120,130,145,0.25)" },
      timeScale: { borderColor: "rgba(120,130,145,0.25)", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Feed bars and mark every trade.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(candles);
    const markers = trades.flatMap((t) => {
      const win = t.r > 0;
      return [
        {
          time: t.entryTime as Time,
          position: (t.side === "Long" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
          color: t.side === "Long" ? "#22c55e" : "#ef4444",
          shape: (t.side === "Long" ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
          text: `${t.side === "Long" ? "L" : "S"} ${t.grade}`,
        },
        {
          time: t.exitTime as Time,
          position: "aboveBar" as const,
          color: win ? "#22c55e" : "#ef4444",
          shape: "circle" as const,
          text: `${t.r > 0 ? "+" : ""}${t.r}R`,
        },
      ];
    });
    // lightweight-charts requires markers in ascending time order.
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);
    chartRef.current?.timeScale().fitContent();
  }, [candles, trades]);

  useEffect(() => {
    setIndex(0);
  }, [trades]);

  // Zoom to the selected trade and draw its levels.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    for (const line of linesRef.current) series.removePriceLine(line);
    linesRef.current = [];
    if (!trade) {
      chart.timeScale().fitContent();
      return;
    }
    linesRef.current = [
      series.createPriceLine({ price: trade.entry, color: "#38bdf8", lineWidth: 1, lineStyle: LineStyle.Solid, title: "entry" }),
      series.createPriceLine({ price: trade.stop, color: "#ef4444", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "stop" }),
      series.createPriceLine({ price: trade.target, color: "#22c55e", lineWidth: 1, lineStyle: LineStyle.Dashed, title: "target" }),
    ];
    const span = Math.max(trade.exitTime - trade.entryTime, 3600);
    chart.timeScale().setVisibleRange({
      from: (trade.entryTime - span) as Time,
      to: (trade.exitTime + span) as Time,
    });
  }, [trade]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <PlayCircle className="h-4 w-4" />
        <span className="text-sm font-semibold">Trade replay</span>
        <span className="text-xs text-muted-foreground">
          {result.symbol} {result.timeframe} · {bars.length} bars · {trades.length} simulated trades
        </span>
        {trades.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Trade {index + 1} of {trades.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIndex((i) => Math.min(trades.length - 1, i + 1))}
              disabled={index >= trades.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {trade && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs">
          <span className="font-semibold">{trade.side}</span>
          <span className="rounded border border-border px-1">{trade.grade}</span>
          <span className="text-muted-foreground">{trade.session}</span>
          <span className="font-mono text-muted-foreground">
            in {trade.entry} at {fmt(trade.entryTime)} · out {trade.exit} at {fmt(trade.exitTime)} · {trade.holdBars} bars
          </span>
          <span className={`ml-auto font-mono font-semibold ${trade.r > 0 ? "text-bull" : "text-red-500"}`}>
            {trade.r > 0 ? "+" : ""}
            {trade.r}R ({trade.outcome})
          </span>
        </div>
      )}

      <div ref={holder} className="h-[420px] w-full" />

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Arrows mark the fill on the bar after the signal formed; circles mark the exit and its R result. Use the
        stepper to walk trade by trade with entry, stop and target drawn.
      </div>
    </div>
  );
}
