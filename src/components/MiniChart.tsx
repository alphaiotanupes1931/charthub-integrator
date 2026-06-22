import { useEffect, useRef, useState } from "react";

interface Props {
  symbol: string;
  width?: string | number;
  height?: number;
  dateRange?: string;
}

export function MiniChart({ symbol, width = "100%", height = 70, dateRange = "1D" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !ref.current) return;
    ref.current.innerHTML = `<div class="tradingview-widget-container__widget" style="width:100%;height:${height}px;background:transparent"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      symbol,
      width: "100%",
      height,
      locale: "en",
      dateRange,
      colorTheme: "dark",
      isTransparent: true,
      backgroundColor: "rgba(0,0,0,0)",
      autosize: false,
      largeChartUrl: "",
      chartOnly: true,
      noTimeScale: true,
      trendLineColor: "rgba(201, 168, 76, 1)",
      underLineColor: "rgba(201, 168, 76, 0.15)",
      underLineBottomColor: "rgba(201, 168, 76, 0)",
    });
    ref.current.appendChild(script);
  }, [mounted, symbol, width, height, dateRange]);

  if (!mounted) {
    return (
      <div
        className="rounded-md overflow-hidden bg-card/40 border border-border/40 animate-pulse"
        style={{ width, height }}
      />
    );
  }

  return (
    <div
      className="tradingview-widget-container bg-background/40 rounded-md overflow-hidden"
      ref={ref}
      style={{ width, height }}
    />
  );
}

interface SymbolOverviewProps {
  symbol: string;
  height?: number;
}

export function SymbolOverview({ symbol, height = 420 }: SymbolOverviewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = `<div class="tradingview-widget-container__widget" style="width:100%;height:${height}px;background:transparent"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      symbols: [[symbol, symbol]],
      chartOnly: false,
      width: "100%",
      height,
      locale: "en",
      colorTheme: "dark",
      isTransparent: true,
      autosize: false,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: false,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "Inter, sans-serif",
      fontSize: "10",
      noTimeScale: false,
      valuesTracking: "1",
      changeMode: "price-and-percent",
      chartType: "area",
      maLineColor: "#c9a84c",
      maLineWidth: 1,
      maLength: 9,
      headerFontSize: "medium",
      lineWidth: 2,
      lineType: 0,
      dateRanges: ["1d|1", "1w|15", "1m|60", "3m|240", "12m|1D", "all|1W"],
      gridLineColor: "rgba(180, 140, 60, 0.06)",
      backgroundColor: "rgba(0,0,0,0)",
      lineColor: "#c9a84c",
      topColor: "rgba(201, 168, 76, 0.25)",
      bottomColor: "rgba(201, 168, 76, 0.0)",
    });
    ref.current.appendChild(script);
  }, [symbol, height]);

  return <div className="tradingview-widget-container bg-background/60 rounded-lg overflow-hidden border border-border/40" ref={ref} style={{ width: "100%", height }} />;
}
