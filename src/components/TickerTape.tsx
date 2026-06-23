import { useEffect, useRef } from "react";

interface Props {
  symbols: { proName: string; title: string }[];
}

/**
 * Live ticker tape powered by TradingView (free, no API key).
 * Replaces the previous hardcoded demo prices.
 */
export function TickerTape({ symbols }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    host.innerHTML = "";

    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    host.appendChild(inner);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols,
      showSymbolLogo: false,
      isTransparent: true,
      displayMode: "adaptive",
      colorTheme: "dark",
      locale: "en",
    });
    host.appendChild(script);

    return () => {
      host.innerHTML = "";
    };
  }, [symbols]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container relative overflow-hidden bg-transparent"
    />
  );
}
