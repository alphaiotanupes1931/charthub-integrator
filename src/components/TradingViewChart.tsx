import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  interval?: string;
}

export function TradingViewChart({ symbol, interval = "D" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      toolbar_bg: "#1a1f2e",
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      details: true,
      hotlist: true,
      calendar: true,
      support_host: "https://www.tradingview.com",
    });
    containerRef.current.appendChild(script);
  }, [symbol, interval]);

  return (
    <div className="tradingview-widget-container h-full w-full" ref={containerRef}>
      <div className="tradingview-widget-container__widget h-full w-full" />
    </div>
  );
}
