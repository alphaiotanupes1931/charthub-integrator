import { useEffect, useMemo, useRef, useState } from "react";
import type { LevelKey } from "@/components/NativeChart";

interface Props {
  symbol: string;
  interval?: string;
  enabled?: Partial<Record<LevelKey, boolean>>;
  sessions?: boolean;
}

// Map our level toggles to TradingView built-in studies (widgetembed name form).
const STUDY_MAP: Partial<Record<LevelKey, string>> = {
  VWAP:  "STD;VWAP",
  SR:    "STD;Pivot%1Points%1Standard",
  ZONES: "STD;Pivot%1Points%1High%1Low",
  POC:   "STD;Visible%20Average%20Price",
  FIB:   "STD;Zig%20Zag",
};

// TradingView widgetembed interval codes.
const INTERVAL_MAP: Record<string, string> = {
  "1": "1", "3": "3", "5": "5", "15": "15", "30": "30", "45": "45",
  "60": "60", "120": "120", "180": "180", "240": "240",
  "D": "D", "1D": "D", "W": "W", "1W": "W", "M": "M", "1M": "M",
};

export function TradingViewChart({ symbol, interval = "D", enabled, sessions: _sessions }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const studies = useMemo(() => {
    const s: string[] = [];
    if (enabled) {
      (Object.keys(STUDY_MAP) as LevelKey[]).forEach((k) => {
        if (enabled[k] && STUDY_MAP[k]) s.push(STUDY_MAP[k]!);
      });
    }
    return s;
  }, [enabled]);

  const src = useMemo(() => {
    const iv = INTERVAL_MAP[interval] ?? "D";
    const params = new URLSearchParams({
      symbol,
      interval: iv,
      hidesidetoolbar: "0",
      hidetoptoolbar: "0",
      symboledit: "1",
      saveimage: "0",
      toolbarbg: "1a1f2e",
      studies: JSON.stringify(studies),
      theme: "dark",
      style: "1",
      timezone: "Etc/UTC",
      withdateranges: "1",
      showpopupbutton: "0",
      locale: "en",
    });
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
  }, [symbol, interval, studies]);

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    const timer = window.setTimeout(() => {
      if (!iframeRef.current?.contentDocument && !loaded) {
        // Iframe still hasn't fired load after 15s → assume blocked.
        setFailed(true);
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [src]);

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={iframeRef}
        key={src}
        src={src}
        title="TradingView chart"
        className="h-full w-full border-0"
        allow="fullscreen"
        onLoad={() => { setLoaded(true); setFailed(false); }}
        onError={() => setFailed(true)}
      />
      {failed && !loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4 text-center">
          <div className="max-w-sm text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Live chart couldn't load</p>
            <p>The TradingView widget was blocked (ad blocker or network). Switch to Native above for the live price feed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
