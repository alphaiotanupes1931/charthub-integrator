import { useEffect, useRef } from "react";
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

  const studies = [
    ...(enabled
      ? (Object.keys(STUDY_MAP) as LevelKey[]).filter((k) => enabled[k]).map((k) => STUDY_MAP[k]!)
      : []),
    ...(sessions ? [SESSIONS_STUDY] : []),
  ];
  // Re-init when toggles change
  const studiesKey = studies.join("|");


  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget h-full w-full";
    containerRef.current.appendChild(inner);

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
      studies,
      support_host: "https://www.tradingview.com",
    });
    containerRef.current.appendChild(script);
  }, [symbol, interval, studiesKey]);

  return <div className="tradingview-widget-container h-full w-full" ref={containerRef} />;
}
