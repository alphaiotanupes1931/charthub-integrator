import { useEffect, useRef } from "react";

interface Props {
  symbols: { proName: string; title: string }[];
}

export function TickerTape({ symbols }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols,
      showSymbolLogo: true,
      isTransparent: true,
      displayMode: "adaptive",
      colorTheme: "dark",
      locale: "en",
    });
    ref.current.appendChild(script);
  }, [symbols]);

  return <div className="tradingview-widget-container" ref={ref} />;
}
