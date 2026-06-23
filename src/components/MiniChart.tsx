import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  width?: string | number;
  height?: number;
  dateRange?: string;
}

/**
 * Embeds a TradingView widget by injecting its loader script into a container.
 * TradingView serves live market data for free, no API key required.
 */
function useTradingViewWidget(
  src: string,
  config: Record<string, unknown>,
  deps: ReadonlyArray<unknown> = [],
) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    // Clear previous render (symbol changes, hot reload, etc.)
    host.innerHTML = "";

    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    host.appendChild(inner);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = src;
    script.async = true;
    script.innerHTML = JSON.stringify(config);
    host.appendChild(script);

    return () => {
      host.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return containerRef;
}

export function MiniChart({ symbol, width = "100%", height = 70, dateRange = "1D" }: Props) {
  const ref = useTradingViewWidget(
    "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js",
    {
      symbol,
      width: "100%",
      height: "100%",
      locale: "en",
      dateRange,
      colorTheme: "dark",
      trendLineColor: "rgba(201, 168, 76, 1)",
      underLineColor: "rgba(201, 168, 76, 0.18)",
      underLineBottomColor: "rgba(201, 168, 76, 0)",
      isTransparent: true,
      autosize: true,
      largeChartUrl: "",
      chartOnly: true,
      noTimeScale: true,
    },
    [symbol, dateRange, height],
  );

  return (
    <div
      ref={ref}
      className="tradingview-widget-container rounded-md overflow-hidden bg-transparent"
      style={{ width, height }}
    />
  );
}

interface SymbolOverviewProps {
  symbol: string;
  height?: number;
}

export function SymbolOverview({ symbol, height = 320 }: SymbolOverviewProps) {
  const ref = useTradingViewWidget(
    "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js",
    {
      symbols: [[symbol.split(":").pop() ?? symbol, `${symbol}|1D`]],
      chartOnly: false,
      width: "100%",
      height: "100%",
      locale: "en",
      colorTheme: "dark",
      autosize: true,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: false,
      hideSymbolLogo: true,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "-apple-system, BlinkMacSystemFont, Inter, sans-serif",
      fontSize: "10",
      noTimeScale: false,
      valuesTracking: "1",
      changeMode: "price-and-percent",
      chartType: "area",
      lineColor: "rgba(201, 168, 76, 1)",
      topColor: "rgba(201, 168, 76, 0.28)",
      bottomColor: "rgba(201, 168, 76, 0)",
      lineWidth: 2,
      backgroundColor: "rgba(0, 0, 0, 0)",
      isTransparent: true,
      dateRanges: ["1d|1", "1w|60", "1m|240", "3m|1D", "12m|1W", "all|1M"],
    },
    [symbol, height],
  );

  return (
    <div
      ref={ref}
      className="tradingview-widget-container rounded-lg overflow-hidden bg-transparent border border-border/40"
      style={{ width: "100%", height }}
    />
  );
}
