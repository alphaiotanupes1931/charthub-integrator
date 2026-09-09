import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Minus as LineIcon, Square as RectIcon, ArrowUpRight, Undo2, Trash2, Eraser as EraserIcon, X as CloseIcon } from "lucide-react";
import type { LevelKey } from "@/components/NativeChart";
import { ChartSourceBadge } from "@/components/ChartSourceBadge";
import { useChartTheme } from "@/hooks/useChartTheme";


interface Props {
  symbol: string;
  interval?: string;
  enabled?: Partial<Record<LevelKey, boolean>>;
  sessions?: boolean;
  /** Chart display style picked in the Levels menu, mapped to TradingView's own style codes. */
  candleType?: string;
  /** Called when the embed loads but never streams data (blocked/blank panel). */
  onStall?: () => void;
  /** Rendered in place of the embed when the live feed is blocked or black. */
  fallback?: React.ReactNode;
}

/** Our style ids → TradingView chart style codes (unsupported ones fall back to candles). */
const TV_STYLE_MAP: Record<string, string> = {
  candle: "1",
  hollow: "9",
  ha: "8",
  bars: "0",
  "hlc-bars": "0",
  "high-low": "12",
  line: "2",
  "line-markers": "13",
  "step-line": "10",
  area: "3",
  "hlc-area": "3",
  baseline: "14",
  columns: "12",
  renko: "4",
  "line-break": "7",
  kagi: "5",
  "point-figure": "6",
  range: "4",
};



const STUDY_MAP: Partial<Record<LevelKey, string>> = {
  VWAP:  "STD;VWAP",
  SR:    "STD;Pivot%1Points%1Standard",
  ZONES: "STD;Pivot%1Points%1High%1Low",
  POC:   "STD;Visible%20Average%20Price",
  FIB:   "STD;Zig%20Zag",
};

const INTERVAL_MAP: Record<string, string> = {
  "1": "1", "3": "3", "5": "5", "15": "15", "30": "30", "45": "45",
  "60": "60", "120": "120", "180": "180", "240": "240",
  "D": "D", "1D": "D", "W": "W", "1W": "W", "M": "M", "1M": "M",
};

type DrawTool = "pen" | "line" | "rect" | "arrow" | "eraser";
type Pt = { x: number; y: number };
type Stroke = { tool: DrawTool; color: string; width: number; points: Pt[] };

export function TradingViewChart({ symbol, interval = "D", enabled, sessions: _sessions, candleType, onStall, fallback }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The embed can load its shell and still render an empty black panel with
  // O0 H0 L0 C0 when the data socket is blocked. We detect that separately.
  const [stalled, setStalled] = useState(false);
  // Once the panel is known-bad we keep the backup feed pinned until the embed
  // actually streams again. Without this the panel flickers between the backup
  // chart and a black embed on every background retry.
  const [downSticky, setDownSticky] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const aliveRef = useRef(false);
  const everAliveRef = useRef(false);
  const onStallRef = useRef(onStall);
  onStallRef.current = onStall;



  const [drawMode, setDrawMode] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool>("pen");
  const [drawColor, setDrawColor] = useState<string>("#fbbf24");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawingRef = useRef(false);

  const studies = useMemo(() => {
    const s: string[] = [];
    if (enabled) {
      (Object.keys(STUDY_MAP) as LevelKey[]).forEach((k) => {
        if (enabled[k] && STUDY_MAP[k]) s.push(STUDY_MAP[k]!);
      });
    }
    return s;
  }, [enabled]);

  // The embed renders its own axes and toolbar, so its theme has to track the
  // app/chart palette or the price labels end up unreadable.
  const { theme: embedTheme, toolbarBg } = useChartTheme();
  const chartBgColor = `#${toolbarBg}`;

  const src = useMemo(() => {
    const iv = INTERVAL_MAP[interval] ?? "D";
    const params = new URLSearchParams({
      symbol,
      interval: iv,
      // Full TradingView chrome: drawing rail, top toolbar, symbol search,
      // indicator picker, date ranges, details and watchlist panels.
      hidesidetoolbar: "0",
      hide_side_toolbar: "0",
      hidetoptoolbar: "0",
      hide_top_toolbar: "0",
      hide_legend: "0",
      symboledit: "1",
      allow_symbol_change: "1",
      details: "1",
      hotlist: "1",
      calendar: "1",
      hideideas: "1",
      saveimage: "1",
      toolbarbg: toolbarBg,
      studies: JSON.stringify(studies),
      theme: embedTheme,
      style: (candleType && TV_STYLE_MAP[candleType]) || "1",
      timezone: "Etc/UTC",
      withdateranges: "1",
      showpopupbutton: "1",
      locale: "en",
    });
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
  }, [symbol, interval, studies, embedTheme, toolbarBg, candleType]);


  // Only a symbol/interval change resets the sticky state; a background retry
  // must not clear it (that is what caused the flicker).
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    setStalled(false);
    setDownSticky(false);
    aliveRef.current = false;
    everAliveRef.current = false;
  }, [src]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!iframeRef.current?.contentDocument && !loaded) {
        setFailed(true);
      }
    }, 9_000);
    return () => window.clearTimeout(timer);
  }, [src, reloadKey, loaded]);

  // The embed talks to its parent window while it streams. If it never says
  // anything at all we treat the panel as blocked. Once it streams we drop the
  // backup feed and hand the panel back to the embed.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.origin === "string" && e.origin.includes("tradingview.com")) {
        aliveRef.current = true;
        everAliveRef.current = true;
        setStalled(false);
        setFailed(false);
        setDownSticky(false);
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => {
      if (!aliveRef.current && !everAliveRef.current) {
        setStalled(true);
        onStallRef.current?.();
      }
    }, 9_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [src, reloadKey]);

  // Pin the backup feed as soon as the panel is known-bad.
  useEffect(() => {
    if (failed || stalled) setDownSticky(true);
  }, [failed, stalled]);

  // Silent auto-recovery: while the embed is blocked or black, keep reloading it
  // in the background every 45s. The backup chart stays put the whole time and
  // only steps aside once the embed streams for real.
  useEffect(() => {
    if (!downSticky) return;
    const timer = window.setInterval(() => {
      aliveRef.current = false;
      setReloadKey((k) => k + 1);
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [downSticky]);





  const redraw = useCallback(() => {
    const cvs = drawCanvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);
    const all = currentStrokeRef.current ? [...strokes, currentStrokeRef.current] : strokes;
    for (const s of all) {
      if (s.points.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (s.tool === "pen") {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
      } else if (s.points.length >= 2) {
        const a = s.points[0], b = s.points[s.points.length - 1];
        if (s.tool === "line") {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        } else if (s.tool === "rect") {
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        } else if (s.tool === "arrow") {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const head = 10 + s.width * 2;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 7), b.y - head * Math.sin(angle - Math.PI / 7));
          ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 7), b.y - head * Math.sin(angle + Math.PI / 7));
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }, [strokes]);

  useEffect(() => {
    const cvs = drawCanvasRef.current;
    const host = hostRef.current;
    if (!cvs || !host) return;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cvs.width = Math.max(1, Math.floor(rect.width * dpr));
      cvs.height = Math.max(1, Math.floor(rect.height * dpr));
      cvs.style.width = `${rect.width}px`;
      cvs.style.height = `${rect.height}px`;
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => { redraw(); }, [strokes, redraw]);

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const cvs = drawCanvasRef.current!;
    const rect = cvs.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const distToSeg = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t*dx), p.y - (a.y + t*dy));
  };
  const hit = (s: Stroke, p: Pt, tol = 10) => {
    if (s.points.length === 0) return false;
    if (s.tool === "pen") {
      for (let i = 1; i < s.points.length; i++) if (distToSeg(p, s.points[i-1], s.points[i]) <= tol) return true;
      return false;
    }
    if (s.points.length < 2) return false;
    const a = s.points[0], b = s.points[s.points.length - 1];
    if (s.tool === "line" || s.tool === "arrow") return distToSeg(p, a, b) <= tol;
    if (s.tool === "rect") {
      const x1 = Math.min(a.x,b.x), x2 = Math.max(a.x,b.x), y1 = Math.min(a.y,b.y), y2 = Math.max(a.y,b.y);
      return [[{x:x1,y:y1},{x:x2,y:y1}],[{x:x2,y:y1},{x:x2,y:y2}],[{x:x2,y:y2},{x:x1,y:y2}],[{x:x1,y:y2},{x:x1,y:y1}]]
        .some(([e1,e2]) => distToSeg(p, e1 as Pt, e2 as Pt) <= tol);
    }
    return false;
  };
  const eraseAt = (p: Pt) => setStrokes((prev) => prev.filter((s) => !hit(s, p)));

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const p = getPoint(e);
    if (drawTool === "eraser") { eraseAt(p); return; }
    currentStrokeRef.current = { tool: drawTool, color: drawColor, width: 2, points: [p] };
    redraw();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawMode || !drawingRef.current) return;
    const p = getPoint(e);
    if (drawTool === "eraser") { eraseAt(p); return; }
    if (!currentStrokeRef.current) return;
    const s = currentStrokeRef.current;
    if (s.tool === "pen") s.points.push(p); else s.points = [s.points[0], p];
    redraw();
  };
  const onPointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const s = currentStrokeRef.current;
    currentStrokeRef.current = null;
    if (s && s.points.length > 0) setStrokes((prev) => [...prev, s]);
    else redraw();
  };

  const showFallback = downSticky && !!fallback;

  // Backup chart: when the embed is blocked or black, our own feed is laid over
  // the same panel so the trader always has a working chart. The embed stays
  // mounted underneath and keeps reloading until it recovers on its own.
  return (
    <div ref={hostRef} className="relative h-full w-full" style={{ background: chartBgColor }}>
      <iframe
        ref={iframeRef}
        key={`${src}|${reloadKey}`}
        src={src}
        title="TradingView chart"
        className="h-full w-full border-0"
        style={{
          // Matches the embed to the panel so a reload never flashes the wrong
          // colour, and keeps native widget UI in the right scheme.
          background: chartBgColor,
          colorScheme: embedTheme,
          ...(showFallback ? { pointerEvents: "none" as const, visibility: "hidden" as const } : null),
        }}
        allow="fullscreen"

        onLoad={() => { setLoaded(true); setFailed(false); }}
        onError={() => setFailed(true)}
      />

      {showFallback && <div className="absolute inset-0 z-20">{fallback}</div>}

      {/* Always tell the trader which feed is drawing this chart. */}
      {!showFallback && (
        <ChartSourceBadge live={loaded && !stalled} label="TradingView" className="absolute right-2 bottom-2 z-30" />
      )}


      {/* Drawing overlay (the backup chart brings its own tools, so ours steps aside) */}
      {!showFallback && (
        <canvas
          ref={drawCanvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute inset-0 z-30"
          style={{
            pointerEvents: drawMode ? "auto" : "none",
            cursor: drawMode ? "crosshair" : "default",
            touchAction: drawMode ? "none" : "auto",
          }}
        />
      )}


      {drawMode && !showFallback && (
        <div className="absolute right-2 bottom-11 sm:right-3 sm:bottom-12 z-40 flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-background/90 backdrop-blur px-1.5 py-1 shadow-lg">
          {([
            { k: "pen", Icon: Pencil, label: "Pen" },
            { k: "line", Icon: LineIcon, label: "Line" },
            { k: "rect", Icon: RectIcon, label: "Rect" },
            { k: "arrow", Icon: ArrowUpRight, label: "Arrow" },
            { k: "eraser", Icon: EraserIcon, label: "Eraser" },
          ] as { k: DrawTool; Icon: typeof Pencil; label: string }[]).map(({ k, Icon, label }) => (
            <button
              key={k}
              type="button"
              onClick={() => setDrawTool(k)}
              title={label}
              aria-label={label}
              className={`inline-flex items-center justify-center rounded p-1.5 transition ${drawTool === k ? "bg-primary/20 text-primary" : "text-foreground/80 hover:bg-muted"}`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {["#fbbf24", "#22d3ee", "#f87171", "#a3e635", "#f472b6", "#ffffff"].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setDrawColor(c)}
              title={c}
              aria-label={`Color ${c}`}
              className={`h-4 w-4 rounded-lg border ${drawColor === c ? "border-foreground scale-110" : "border-border/60"} transition`}
              style={{ background: c }}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <button type="button" onClick={() => setStrokes((p) => p.slice(0, -1))} title="Undo" aria-label="Undo" className="p-1.5 rounded text-foreground/80 hover:bg-muted">
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setStrokes([])} title="Clear all" aria-label="Clear all" className="p-1.5 rounded text-foreground/80 hover:bg-muted">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!showFallback && (
        <div className="absolute right-2 bottom-2 sm:right-3 sm:bottom-3 z-40">
          <button
            type="button"
            onClick={() => setDrawMode((v) => !v)}
            title={drawMode ? "Exit draw mode (chart interactive again)" : "Draw on chart"}
            aria-label={drawMode ? "Exit draw mode" : "Draw on chart"}
            className={`inline-flex items-center gap-1.5 rounded-xl border backdrop-blur px-2 py-1.5 text-[10px] font-mono tracking-tight transition-colors ${
              drawMode
                ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20"
                : "border-border/60 bg-background/80 hover:bg-background text-foreground/90 hover:text-foreground"
            }`}
          >
            {drawMode ? <CloseIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{drawMode ? "Done" : "Draw"}</span>
          </button>
        </div>
      )}

    </div>
  );
}
