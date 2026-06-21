import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  width?: string | number;
  height?: string | number;
  dateRange?: string;
}

export function MiniChart({ symbol, width = "100%", height = 70, dateRange = "1D" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      width,
      height,
      locale: "en",
      dateRange,
      colorTheme: "dark",
      isTransparent: true,
      autosize: false,
      largeChartUrl: "",
      chartOnly: true,
      noTimeScale: true,
    });
    ref.current.appendChild(script);
  }, [symbol, width, height, dateRange]);

  return <div className="tradingview-widget-container" ref={ref} style={{ width, height }} />;
}

interface SymbolOverviewProps {
  symbol: string;
  height?: number;
}

export function SymbolOverview({ symbol, height = 420 }: SymbolOverviewProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [[symbol, symbol]],
      chartOnly: false,
      width: "100%",
      height,
      locale: "en",
      colorTheme: "dark",
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
      maLineColor: "#2962FF",
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

  return <div className="tradingview-widget-container" ref={ref} />;
}
