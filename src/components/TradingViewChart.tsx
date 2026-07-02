import { useEffect, useRef, useState } from "react";
import type { LevelKey } from "@/components/NativeChart";

interface Props {
  symbol: string;
  interval?: string;
  enabled?: Partial<Record<LevelKey, boolean>>;
  sessions?: boolean;
}

// Map our level toggles to TradingView embed-widget built-in studies.
// Levels without a TV equivalent (FVG, LIQ) are Native-only.
const STUDY_MAP: Partial<Record<LevelKey, string>> = {
  VWAP:  "VWAP@tv-basicstudies",
  SR:    "PivotPointsStandard@tv-basicstudies",
  ZONES: "PivotPointsHighLow@tv-basicstudies",
  POC:   "VbPSessions@tv-volumebyprice",
  FIB:   "ZigZag@tv-basicstudies",
};

const SESSIONS_STUDY = "Sessions@tv-basicstudies";

export function TradingViewChart({ symbol, interval = "D", enabled, sessions }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const studies = [
    ...(enabled
      ? (Object.keys(STUDY_MAP) as LevelKey[]).filter((k) => enabled[k]).map((k) => STUDY_MAP[k]!)
      : []),
    ...(sessions ? [SESSIONS_STUDY] : []),
  ];
  const studiesKey = studies.join("|");

  useEffect(() => {
    if (!containerRef.current) return;
    setFailed(false);
    setLoaded(false);
    containerRef.current.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    inner.style.height = "100%";
    inner.style.width = "100%";
    containerRef.current.appendChild(inner);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.text = JSON.stringify({
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
      studies,
      support_host: "https://www.tradingview.com",
    });
    script.onerror = () => setFailed(true);
    containerRef.current.appendChild(script);

    // If TradingView never injects an iframe within ~6s, treat as failed
    const check = window.setTimeout(() => {
      const iframe = containerRef.current?.querySelector("iframe");
      if (iframe) setLoaded(true);
      else setFailed(true);
    }, 6000);

    return () => window.clearTimeout(check);
  }, [symbol, interval, studiesKey]);

  return (
    <div className="relative h-full w-full">
      <div className="tradingview-widget-container h-full w-full" ref={containerRef} />
      {failed && !loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4 text-center">
          <div className="max-w-sm text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Live chart couldn't load</p>
            <p>The TradingView widget was blocked or timed out. Switch to Native above for the live price feed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
