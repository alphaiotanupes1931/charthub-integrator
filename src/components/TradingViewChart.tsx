import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Minus as LineIcon, Square as RectIcon, ArrowUpRight, Undo2, Trash2, Eraser as EraserIcon, X as CloseIcon } from "lucide-react";
import type { LevelKey } from "@/components/NativeChart";

interface Props {
  symbol: string;
  interval?: string;
  enabled?: Partial<Record<LevelKey, boolean>>;
  sessions?: boolean;
  /** Called when the embed loads but never streams data (blocked/blank panel). */
  onStall?: () => void;
}


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

export function TradingViewChart({ symbol, interval = "D", enabled, sessions: _sessions, onStall }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The embed can load its shell and still render an empty black panel with
  // O0 H0 L0 C0 when the data socket is blocked. We detect that separately.
  const [stalled, setStalled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const aliveRef = useRef(false);
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
    setStalled(false);
    aliveRef.current = false;
    const timer = window.setTimeout(() => {
      if (!iframeRef.current?.contentDocument && !loaded) {
        setFailed(true);
      }
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [src, reloadKey]);

  // The embed talks to its parent window while it streams. No messages inside
  // 14s after the shell loads means the data feed is blocked and the panel is
  // sitting there black with zeroed OHLC.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (typeof e.origin === "string" && e.origin.includes("tradingview.com")) {
        aliveRef.current = true;
        setStalled(false);
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => {
      if (!aliveRef.current) {
        setStalled(true);
        onStallRef.current?.();
      }
    }, 14_000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [src, reloadKey]);


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

  return (
    <div ref={hostRef} className="relative h-full w-full">
      <iframe
        ref={iframeRef}
        key={`${src}|${reloadKey}`}
        src={src}
        title="TradingView chart"
        className="h-full w-full border-0"
        allow="fullscreen"
        onLoad={() => { setLoaded(true); setFailed(false); }}
        onError={() => setFailed(true)}
      />
      {(failed || stalled) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/85 p-4 text-center">
          <div className="max-w-sm text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Live chart is not streaming</p>
            <p>
              The embedded TradingView feed is blocked on this network or browser, so the panel stays black with
              zeroed prices. The Setup tab uses our own price feed and always works.
            </p>
            <button
              type="button"
              onClick={() => { setStalled(false); setFailed(false); setReloadKey((k) => k + 1); }}
              className="mt-3 rounded-md border border-border px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-foreground hover:bg-muted"
            >
              Retry live chart
            </button>
          </div>
        </div>
      )}


      {/* Drawing overlay */}
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

      {drawMode && (
        <div className="absolute right-2 bottom-11 sm:right-3 sm:bottom-12 z-40 flex flex-wrap items-center gap-1 rounded-md border border-border bg-background/90 backdrop-blur px-1.5 py-1 shadow-lg">
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
              className={`h-4 w-4 rounded-sm border ${drawColor === c ? "border-foreground scale-110" : "border-border/60"} transition`}
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

      <div className="absolute right-2 bottom-2 sm:right-3 sm:bottom-3 z-40">
        <button
          type="button"
          onClick={() => setDrawMode((v) => !v)}
          title={drawMode ? "Exit draw mode (chart interactive again)" : "Draw on chart"}
          aria-label={drawMode ? "Exit draw mode" : "Draw on chart"}
          className={`inline-flex items-center gap-1.5 rounded-md border backdrop-blur px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
            drawMode
              ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20"
              : "border-border bg-background/80 hover:bg-background text-foreground/90 hover:text-foreground"
          }`}
        >
          {drawMode ? <CloseIcon className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{drawMode ? "Done" : "Draw"}</span>
        </button>
      </div>
    </div>
  );
}
