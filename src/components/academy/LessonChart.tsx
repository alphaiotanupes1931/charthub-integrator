import { useEffect, useRef, useState } from "react";
import type { LessonChartType } from "@/lib/academy-content";

const ANIM_CSS = `
@keyframes lcDraw { from { stroke-dashoffset: 1400; } to { stroke-dashoffset: 0; } }
@keyframes lcFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes lcPop  { from { opacity: 0; transform: scale(.72); } to { opacity: 1; transform: scale(1); } }
@keyframes lcPulse { 0%,100% { opacity: .9; } 50% { opacity: .35; } }
.lc-live path[data-anim="draw"], .lc-live path[fill="none"] { stroke-dasharray: 1400; stroke-dashoffset: 1400; animation: lcDraw 1.5s cubic-bezier(.4,0,.2,1) forwards; }
.lc-live g[data-anim="candle"] { opacity: 0; animation: lcPop .38s ease forwards; transform-box: fill-box; transform-origin: center; }
.lc-live g[data-anim="tag"] { opacity: 0; animation: lcFade .5s ease forwards; animation-delay: 1.15s; }
.lc-live rect[data-anim="zone"] { opacity: 0; animation: lcFade .7s ease .25s forwards; }
.lc-live circle { opacity: 0; animation: lcPop .35s ease forwards; animation-delay: .9s; }
.lc-live line[data-anim="level"], .lc-live line[stroke-dasharray="4 4"] { animation: lcPulse 3.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .lc-live path { stroke-dashoffset: 0 !important; animation: none !important; }
  .lc-live g[data-anim], .lc-live rect[data-anim], .lc-live circle { opacity: 1; animation: none; }
  .lc-live line { animation: none; }
}

`;

/**
 * Small illustrative SVG diagrams used inside academy lesson callouts.
 * All diagrams share the same viewBox + palette so they feel cohesive.
 * Diagrams animate in (line draw, candle pop, label fade) when scrolled into view.
 */
export function LessonChart({ type }: { type: LessonChartType }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setLive(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { setLive(true); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
      <svg viewBox="0 0 600 260" className={`w-full h-auto ${live ? "lc-live" : "opacity-0"}`} role="img" aria-label={type}>
        <style>{ANIM_CSS}</style>
        <defs>
          <linearGradient id="grid-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--muted-foreground) / 0.14)" />
            <stop offset="100%" stopColor="hsl(var(--muted-foreground) / 0.06)" />
          </linearGradient>
        </defs>
        {/* Axes */}
        <line x1="40" y1="20" x2="40" y2="230" stroke="hsl(var(--muted-foreground) / 0.35)" strokeWidth="1" />
        <line x1="40" y1="230" x2="580" y2="230" stroke="hsl(var(--muted-foreground) / 0.35)" strokeWidth="1" />
        {/* Grid lines */}
        {[70, 120, 170, 220].map((y) => (
          <line key={y} x1="40" y1={y} x2="580" y2={y} stroke="url(#grid-fade)" strokeDasharray="2 4" />
        ))}
        <text x="20" y="130" fontSize="10" fill="hsl(var(--muted-foreground))" transform="rotate(-90 20 130)">PRICE</text>
        <text x="300" y="252" fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">TIME —&gt;</text>

        {renderShape(type)}
      </svg>
    </div>
  );
}


const BULL = "#22c55e";
const BEAR = "#ef4444";
const NEUTRAL = "hsl(var(--muted-foreground))";
const ACCENT = "#38bdf8";
const NEUTRAL_HEX = "#94a3b8";

type Tone = "bull" | "bear" | "accent" | "neutral";

function toneColor(tone: Tone) {
  return tone === "bull" ? BULL : tone === "bear" ? BEAR : tone === "neutral" ? NEUTRAL_HEX : ACCENT;
}

function label(x: number, y: number, text: string, tone: Tone = "accent", delay = 1.15) {
  const bg = toneColor(tone);
  const w = Math.max(text.length * 6.5 + 14, 60);
  return (
    <g data-anim="tag" style={{ animationDelay: `${delay}s` }}>
      <rect x={x - w / 2} y={y - 12} width={w} height={20} rx={10} fill={`${bg}22`} stroke={bg} strokeWidth={1} />
      <text x={x} y={y + 2} fontSize="10" fontWeight="700" textAnchor="middle" fill={bg}>{text}</text>
    </g>
  );
}

function candle(x: number, o: number, h: number, l: number, c: number, w = 12, i = 0) {
  const bull = c < o; // in SVG lower y = higher price; keep intuitive
  const color = bull ? BULL : BEAR;
  const top = Math.min(o, c);
  const bot = Math.max(o, c);
  return (
    <g key={`c-${x}`} data-anim="candle" style={{ animationDelay: `${0.06 * i}s` }}>
      <line x1={x} y1={h} x2={x} y2={l} stroke={color} strokeWidth={1.2} />
      <rect x={x - w / 2} y={top} width={w} height={Math.max(bot - top, 2)} fill={color} opacity={0.85} />
    </g>
  );
}

/** Animated polyline path from [x,y] points. */
function line(pts: number[][], tone: Tone = "accent", width = 2.5) {
  const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
  return <path d={d} fill="none" stroke={toneColor(tone)} strokeWidth={width} strokeLinecap="round" data-anim="draw" />;
}

/** Dashed horizontal level with a pulsing feel. */
function level(y: number, tone: Tone = "accent", x1 = 40, x2 = 580) {
  return <line x1={x1} y1={y} x2={x2} y2={y} stroke={toneColor(tone)} strokeDasharray="4 4" data-anim="level" opacity={0.85} />;
}

function zone(x: number, y: number, w: number, h: number, tone: Tone = "accent") {
  return <rect x={x} y={y} width={w} height={h} rx={3} fill={`${toneColor(tone)}1e`} stroke={`${toneColor(tone)}66`} data-anim="zone" />;
}

function dot(x: number, y: number, tone: Tone = "accent", delay = 1) {
  return <circle cx={x} cy={y} r={5} fill={toneColor(tone)} style={{ animationDelay: `${delay}s` }} />;
}

function note(x: number, y: number, text: string, tone: Tone = "neutral", delay = 1.3, anchor: "start" | "middle" | "end" = "middle") {
  return (
    <g data-anim="tag" style={{ animationDelay: `${delay}s` }}>
      <text x={x} y={y} fontSize="9.5" fontWeight="600" textAnchor={anchor} fill={toneColor(tone)}>{text}</text>
    </g>
  );
}


function renderShape(type: LessonChartType) {
  switch (type) {
    case "buy-low-sell-high": {
      const pts = [
        [70, 130], [130, 155], [180, 180], [230, 145], [280, 100],
        [330, 70], [380, 95], [430, 110], [480, 95], [540, 115],
      ];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <path d={d} fill="none" stroke={ACCENT} strokeWidth="2.5" />
          <circle cx={180} cy={180} r="5" fill={BULL} />
          {label(180, 205, "BUY LOW", "bull")}
          <circle cx={330} cy={70} r="5" fill={BEAR} />
          {label(330, 50, "SELL HIGH", "bear")}
          <line x1={40} y1={180} x2={580} y2={180} stroke={BULL} strokeDasharray="3 4" opacity={0.4} />
          <line x1={40} y1={70} x2={580} y2={70} stroke={BEAR} strokeDasharray="3 4" opacity={0.4} />
        </>
      );
    }
    case "candles-zones": {
      const cs = [
        { x: 80, o: 130, h: 110, l: 140, c: 120 },
        { x: 110, o: 120, h: 105, l: 135, c: 130 },
        { x: 140, o: 130, h: 120, l: 150, c: 145 },
        { x: 170, o: 145, h: 140, l: 165, c: 160 },
        { x: 200, o: 160, h: 145, l: 170, c: 150 },
        { x: 230, o: 150, h: 135, l: 160, c: 140 },
        { x: 260, o: 140, h: 125, l: 155, c: 135 },
        { x: 290, o: 135, h: 110, l: 145, c: 115 },
        { x: 320, o: 115, h: 90,  l: 125, c: 100 },
        { x: 350, o: 100, h: 75,  l: 110, c: 85  },
        { x: 380, o: 85,  h: 60,  l: 100, c: 70  },
        { x: 410, o: 70,  h: 50,  l: 90,  c: 60  },
        { x: 440, o: 60,  h: 45,  l: 80,  c: 75  },
        { x: 470, o: 75,  h: 60,  l: 95,  c: 90  },
        { x: 500, o: 90,  h: 70,  l: 105, c: 80  },
        { x: 530, o: 80,  h: 65,  l: 100, c: 95  },
      ];
      return (
        <>
          <rect x={155} y={40} width={130} height={190} fill={`${BULL}18`} />
          <rect x={295} y={40} width={130} height={190} fill={`${BEAR}18`} />
          {cs.map((k) => candle(k.x, k.o, k.h, k.l, k.c))}
          {label(220, 245, "BUYERS", "bull")}
          {label(360, 245, "SELLERS", "bear")}
          {label(80, 40, "NAS100 - 1D")}
        </>
      );
    }
    case "trend-up": {
      const pts = [[60, 220], [120, 200], [180, 180], [240, 195], [300, 155], [360, 170], [420, 120], [480, 135], [540, 80]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <path d={d} stroke={BULL} strokeWidth="2.5" fill="none" />
          {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} fill={BULL} />)}
          {label(540, 60, "HIGHER HIGHS", "bull")}
        </>
      );
    }
    case "trend-down": {
      const pts = [[60, 60], [120, 90], [180, 110], [240, 95], [300, 140], [360, 125], [420, 175], [480, 165], [540, 210]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <path d={d} stroke={BEAR} strokeWidth="2.5" fill="none" />
          {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} fill={BEAR} />)}
          {label(540, 230, "LOWER LOWS", "bear")}
        </>
      );
    }
    case "range": {
      const pts = [[60, 90], [110, 190], [170, 100], [220, 195], [280, 95], [340, 190], [400, 100], [460, 195], [530, 100]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <line x1={40} y1={90} x2={580} y2={90} stroke={ACCENT} strokeDasharray="4 4" />
          <line x1={40} y1={195} x2={580} y2={195} stroke={ACCENT} strokeDasharray="4 4" />
          <path d={d} stroke={NEUTRAL} strokeWidth="2" fill="none" />
          {label(540, 78, "CEILING", "accent")}
          {label(540, 213, "FLOOR", "accent")}
        </>
      );
    }
    case "breakout":
    case "continuation": {
      const pts = [[60, 190], [120, 170], [180, 180], [240, 165], [300, 175], [360, 130], [420, 100], [480, 85], [540, 60]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <line x1={40} y1={165} x2={580} y2={165} stroke={BEAR} strokeDasharray="4 4" opacity={0.7} />
          <path d={d} stroke={BULL} strokeWidth="2.5" fill="none" />
          <circle cx={340} cy={140} r={5} fill={BULL} />
          {label(340, 118, "BREAKOUT", "bull")}
        </>
      );
    }
    case "retest": {
      return (
        <>
          <line x1={40} y1={140} x2={580} y2={140} stroke={ACCENT} strokeDasharray="4 4" />
          {[
            [70, 180], [120, 160], [170, 170], [220, 145], [270, 120],
            [320, 100], [370, 130], [410, 138], [460, 115], [520, 80],
          ].map(([x, y], i, arr) => (
            <g key={i}>
              <circle cx={x} cy={y} r={3} fill={BULL} />
              {i > 0 && <line x1={arr[i - 1][0]} y1={arr[i - 1][1]} x2={x} y2={y} stroke={BULL} strokeWidth={2} />}
            </g>
          ))}
          {label(400, 155, "RETEST", "accent")}
          {label(560, 128, "BROKEN LEVEL", "accent")}
        </>
      );
    }
    case "rejection": {
      const cs = [
        { x: 100, o: 170, h: 160, l: 190, c: 180 },
        { x: 160, o: 180, h: 165, l: 195, c: 175 },
        { x: 220, o: 175, h: 155, l: 185, c: 160 },
        { x: 280, o: 160, h: 60,  l: 170, c: 150 }, // long upper wick
        { x: 340, o: 150, h: 140, l: 170, c: 165 },
        { x: 400, o: 165, h: 160, l: 195, c: 190 },
        { x: 460, o: 190, h: 180, l: 210, c: 200 },
      ];
      return (
        <>
          <line x1={40} y1={70} x2={580} y2={70} stroke={BEAR} strokeDasharray="4 4" />
          {cs.map((k) => candle(k.x, k.o, k.h, k.l, k.c, 16))}
          {label(280, 45, "REJECTION WICK", "bear")}
        </>
      );
    }
    case "stop-hunt":
    case "liquidity-sweep": {
      const pts = [[60, 150], [120, 145], [180, 155], [240, 148], [300, 60], [360, 170], [420, 190], [480, 200], [540, 215]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <line x1={40} y1={90} x2={580} y2={90} stroke={ACCENT} strokeDasharray="4 4" />
          <path d={d} stroke={BEAR} strokeWidth="2.5" fill="none" />
          <circle cx={300} cy={60} r={5} fill={BEAR} />
          {label(300, 40, "SWEEP", "bear")}
          {label(560, 80, "LIQUIDITY", "accent")}
        </>
      );
    }
    case "equal-highs": {
      return (
        <>
          <line x1={40} y1={80} x2={580} y2={80} stroke={ACCENT} strokeDasharray="4 4" />
          {[
            [80, 200], [140, 82], [200, 160], [280, 84], [360, 150], [430, 60], [500, 130], [560, 170],
          ].map(([x, y], i, arr) => (
            <g key={i}>
              <circle cx={x} cy={y} r={3} fill={NEUTRAL} />
              {i > 0 && <line x1={arr[i - 1][0]} y1={arr[i - 1][1]} x2={x} y2={y} stroke={NEUTRAL} strokeWidth={1.8} />}
            </g>
          ))}
          {label(140, 65, "HIGH", "accent")}
          {label(280, 65, "EQUAL HIGH", "accent")}
          {label(430, 43, "SWEEP", "bear")}
        </>
      );
    }
    case "equal-lows": {
      return (
        <>
          <line x1={40} y1={200} x2={580} y2={200} stroke={ACCENT} strokeDasharray="4 4" />
          {[
            [80, 80], [140, 198], [200, 130], [280, 200], [360, 130], [430, 220], [500, 150], [560, 110],
          ].map(([x, y], i, arr) => (
            <g key={i}>
              <circle cx={x} cy={y} r={3} fill={NEUTRAL} />
              {i > 0 && <line x1={arr[i - 1][0]} y1={arr[i - 1][1]} x2={x} y2={y} stroke={NEUTRAL} strokeWidth={1.8} />}
            </g>
          ))}
          {label(430, 235, "SWEEP", "bull")}
        </>
      );
    }
    case "support-resistance": {
      const pts = [[60, 100], [110, 175], [170, 105], [230, 170], [290, 110], [350, 175], [410, 108], [470, 172], [540, 115]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <line x1={40} y1={105} x2={580} y2={105} stroke={BEAR} strokeDasharray="4 4" />
          <line x1={40} y1={175} x2={580} y2={175} stroke={BULL} strokeDasharray="4 4" />
          <path d={d} stroke={NEUTRAL} strokeWidth="2" fill="none" />
          {label(560, 93, "RESISTANCE", "bear")}
          {label(560, 193, "SUPPORT", "bull")}
        </>
      );
    }
    case "clean-setup": {
      const pts = [[60, 200], [110, 195], [170, 185], [230, 180], [290, 145], [350, 155], [420, 90], [490, 100], [560, 55]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <line x1={40} y1={180} x2={580} y2={180} stroke={ACCENT} strokeDasharray="4 4" />
          <path d={d} stroke={BULL} strokeWidth="2.5" fill="none" />
          <circle cx={290} cy={145} r={5} fill={BULL} />
          {label(290, 125, "ENTRY", "bull")}
          {label(560, 195, "SUPPORT", "accent")}
          {label(560, 40, "TARGET", "bull")}
        </>
      );
    }
    case "messy-setup": {
      const pts = [[60, 150], [110, 100], [170, 180], [230, 90], [290, 200], [350, 100], [420, 190], [480, 90], [540, 150]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          {[80, 110, 140, 170, 200].map((y) => (
            <line key={y} x1={40} y1={y} x2={580} y2={y} stroke={NEUTRAL} strokeDasharray="2 5" opacity={0.4} />
          ))}
          <path d={d} stroke={BEAR} strokeWidth="2" fill="none" />
          {label(560, 45, "TOO MUCH CHOP", "bear")}
        </>
      );
    }
    case "risk-reward":
    case "stop-placement":
    case "target-placement": {
      const pts = [[60, 200], [130, 180], [200, 175], [270, 160], [340, 140], [410, 100], [490, 80], [560, 55]];
      const d = "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
      return (
        <>
          <line x1={40} y1={175} x2={580} y2={175} stroke={ACCENT} strokeDasharray="4 4" />
          <line x1={40} y1={210} x2={580} y2={210} stroke={BEAR} strokeDasharray="4 4" />
          <line x1={40} y1={60} x2={580} y2={60} stroke={BULL} strokeDasharray="4 4" />
          <path d={d} stroke={NEUTRAL} strokeWidth="2" fill="none" />
          <circle cx={270} cy={175} r={5} fill={ACCENT} />
          {label(560, 195, "ENTRY", "accent")}
          {label(560, 225, "STOP", "bear")}
          {label(560, 45, "TARGET", "bull")}
        </>
      );
    }
    case "chart-axes": {
      return (
        <>
          {line([[60, 210], [120, 195], [180, 200], [240, 170], [300, 175], [360, 140], [420, 145], [480, 105], [545, 80]], "accent")}
          {note(300, 40, "PRICE GOES UP AS TIME MOVES RIGHT", "accent")}
          {label(120, 225, "PAST", "neutral", 1.0)}
          {label(520, 225, "NOW", "accent", 1.3)}
        </>
      );
    }
    case "candle-anatomy": {
      return (
        <>
          {/* bullish candle */}
          <g data-anim="candle">
            <line x1={190} y1={50} x2={190} y2={220} stroke={BULL} strokeWidth={1.5} />
            <rect x={172} y={95} width={36} height={85} fill={BULL} opacity={0.85} rx={2} />
          </g>
          {/* bearish candle */}
          <g data-anim="candle" style={{ animationDelay: "0.25s" }}>
            <line x1={410} y1={45} x2={410} y2={215} stroke={BEAR} strokeWidth={1.5} />
            <rect x={392} y={80} width={36} height={90} fill={BEAR} opacity={0.85} rx={2} />
          </g>
          {note(120, 60, "HIGH (WICK)", "neutral", 1.1, "start")}
          {note(120, 100, "CLOSE", "bull", 1.2, "start")}
          {note(120, 185, "OPEN", "bull", 1.3, "start")}
          {note(120, 225, "LOW (WICK)", "neutral", 1.4, "start")}
          {label(190, 245, "BULLISH", "bull", 1.5)}
          {label(410, 245, "BEARISH", "bear", 1.6)}
          {note(470, 85, "OPEN", "bear", 1.2, "start")}
          {note(470, 175, "CLOSE", "bear", 1.3, "start")}
        </>
      );
    }
    case "timeframe-zoom": {
      return (
        <>
          {zone(60, 120, 150, 90, "accent")}
          {line([[60, 200], [110, 185], [160, 165], [210, 150], [260, 130], [320, 140], [380, 100], [450, 110], [545, 65]], "bull")}
          {line([[240, 175], [270, 150], [300, 190], [330, 160], [360, 200], [390, 165], [420, 205], [460, 175], [500, 210], [545, 185]], "neutral", 1.8)}
          {label(135, 110, "DAILY TREND", "bull", 1.0)}
          {label(400, 225, "5M NOISE", "neutral", 1.3)}
          {note(300, 40, "SAME MARKET, DIFFERENT ZOOM", "accent")}
        </>
      );
    }
    case "volume-basics": {
      const bars = [
        { x: 80, h: 30, up: true }, { x: 130, h: 22, up: true }, { x: 180, h: 60, up: true },
        { x: 230, h: 18, up: false }, { x: 280, h: 14, up: false }, { x: 330, h: 78, up: true },
        { x: 380, h: 26, up: false }, { x: 430, h: 20, up: false }, { x: 480, h: 66, up: false },
      ];
      return (
        <>
          {line([[80, 180], [130, 172], [180, 130], [230, 140], [280, 148], [330, 90], [380, 105], [430, 112], [480, 155]], "accent", 2)}
          {bars.map((b, i) => (
            <g key={b.x} data-anim="candle" style={{ animationDelay: `${0.07 * i}s` }}>
              <rect x={b.x - 9} y={228 - b.h} width={18} height={b.h} fill={b.up ? BULL : BEAR} opacity={0.6} rx={2} />
            </g>
          ))}
          {label(330, 60, "HIGH VOLUME BREAK", "bull", 1.1)}
          {label(255, 195, "LOW VOLUME DRIFT", "neutral", 1.4)}
        </>
      );
    }
    case "level-flip": {
      return (
        <>
          {level(140, "accent")}
          {line([[60, 190], [110, 160], [160, 180], [220, 145], [275, 120], [330, 145], [385, 138], [440, 105], [545, 70]], "bull")}
          {dot(385, 138, "accent", 1.0)}
          {label(230, 128, "RESISTANCE", "bear", 1.1)}
          {label(470, 155, "NOW SUPPORT", "bull", 1.4)}
        </>
      );
    }
    case "fakeout": {
      const cs = [
        { x: 90, o: 170, h: 160, l: 185, c: 178 },
        { x: 140, o: 178, h: 165, l: 190, c: 172 },
        { x: 190, o: 172, h: 150, l: 180, c: 155 },
        { x: 240, o: 155, h: 70, l: 165, c: 150 },
        { x: 290, o: 150, h: 140, l: 178, c: 175 },
        { x: 340, o: 175, h: 168, l: 195, c: 190 },
        { x: 390, o: 190, h: 182, l: 205, c: 200 },
      ];
      return (
        <>
          {level(95, "bear")}
          {cs.map((k, i) => candle(k.x, k.o, k.h, k.l, k.c, 16, i))}
          {label(240, 50, "WICK ONLY = FAKEOUT", "bear", 1.1)}
          {/* real break */}
          {candle(470, 200, 150, 205, 160, 16, 7)}
          {candle(520, 160, 120, 168, 128, 16, 8)}
          {label(495, 100, "CLOSE = REAL", "bull", 1.5)}
        </>
      );
    }
    case "bbhg": {
      return (
        <>
          {level(150, "accent")}
          {line([[60, 200], [120, 190], [175, 195], [215, 125], [265, 145], [305, 152], [350, 148], [400, 110], [470, 85], [545, 55]], "bull")}
          {dot(215, 125, "accent", 0.9)}
          {dot(305, 152, "accent", 1.1)}
          {label(215, 105, "1 BREAK", "accent", 1.0)}
          {label(268, 178, "2 BREATHE", "neutral", 1.2)}
          {label(345, 178, "3 HOLD", "accent", 1.4)}
          {label(500, 60, "4 GO", "bull", 1.6)}
        </>
      );
    }
    case "reaction-map": {
      return (
        <>
          {level(120, "accent")}
          {candle(110, 150, 122, 165, 140, 16, 0)}
          {candle(150, 140, 124, 155, 148, 16, 1)}
          {label(130, 185, "RESPECTED", "bull", 1.0)}
          {candle(290, 150, 60, 158, 148, 16, 2)}
          {label(290, 45, "REJECTED", "bear", 1.2)}
          {candle(450, 140, 118, 148, 122, 16, 3)}
          {candle(490, 122, 80, 128, 88, 16, 4)}
          {label(470, 185, "BROKEN", "bear", 1.4)}
        </>
      );
    }
    case "momentum-shift": {
      const cs = [
        { x: 90, o: 200, h: 165, l: 205, c: 170 },
        { x: 140, o: 170, h: 135, l: 175, c: 140 },
        { x: 190, o: 140, h: 112, l: 148, c: 118 },
        { x: 240, o: 118, h: 100, l: 125, c: 106 },
        { x: 290, o: 106, h: 96, l: 112, c: 100 },
        { x: 340, o: 100, h: 92, l: 108, c: 98 },
        { x: 390, o: 98, h: 94, l: 130, c: 126 },
        { x: 440, o: 126, h: 118, l: 165, c: 160 },
        { x: 495, o: 160, h: 150, l: 205, c: 198 },
      ];
      return (
        <>
          {cs.map((k, i) => candle(k.x, k.o, k.h, k.l, k.c, 16, i))}
          {label(150, 220, "BIG PUSHES", "bull", 1.0)}
          {label(315, 70, "SMALLER PUSHES", "neutral", 1.3)}
          {label(470, 100, "SHIFT", "bear", 1.6)}
        </>
      );
    }
    case "read-loop": {
      const nodes = [
        { x: 130, y: 130, t: "STRUCTURE", tone: "accent" as Tone },
        { x: 300, y: 130, t: "LEVEL", tone: "bull" as Tone },
        { x: 470, y: 130, t: "REACTION", tone: "bear" as Tone },
      ];
      return (
        <>
          {nodes.map((n, i) => (
            <g key={n.t} data-anim="tag" style={{ animationDelay: `${0.3 + i * 0.3}s` }}>
              <circle cx={n.x} cy={n.y} r={52} fill={`${toneColor(n.tone)}18`} stroke={toneColor(n.tone)} style={{ animationDelay: `${0.3 + i * 0.3}s` }} />
              <text x={n.x} y={n.y + 4} fontSize="11" fontWeight="700" textAnchor="middle" fill={toneColor(n.tone)}>{n.t}</text>
            </g>
          ))}
          {line([[186, 130], [242, 130]], "neutral", 2)}
          {line([[356, 130], [412, 130]], "neutral", 2)}
          {line([[470, 190], [300, 215], [130, 190]], "neutral", 1.6)}
          {note(300, 60, "REPEAT ON EVERY CHART", "neutral", 1.5)}
        </>
      );
    }
    case "entry-types": {
      return (
        <>
          {level(140, "neutral")}
          {line([[60, 190], [130, 175], [200, 160], [270, 145], [340, 150], [410, 120], [480, 105], [545, 75]], "accent")}
          {level(100, "bear")}
          {level(185, "bull")}
          {label(120, 128, "MARKET = NOW", "neutral", 1.0)}
          {label(120, 200, "LIMIT = BELOW", "bull", 1.2)}
          {label(120, 88, "STOP = ABOVE", "bear", 1.4)}
          {dot(270, 145, "neutral", 1.0)}
        </>
      );
    }
    case "exit-plan": {
      return (
        <>
          {zone(60, 60, 520, 80, "bull")}
          {zone(60, 175, 520, 45, "bear")}
          {level(160, "accent")}
          {line([[70, 160], [150, 150], [230, 165], [310, 130], [390, 110], [470, 95], [545, 78]], "accent")}
          {label(520, 175, "TARGET ZONE", "bull", 1.0)}
          {label(520, 210, "STOP ZONE", "bear", 1.2)}
          {label(130, 148, "ENTRY", "accent", 1.4)}
        </>
      );
    }
    case "invalidation": {
      return (
        <>
          {level(120, "accent")}
          {level(185, "bear")}
          {line([[70, 130], [140, 115], [210, 128], [280, 150], [350, 178], [420, 205], [500, 212], [545, 218]], "bear")}
          {dot(350, 178, "bear", 1.0)}
          {label(140, 100, "IDEA VALID", "bull", 1.0)}
          {label(430, 172, "IDEA BROKEN", "bear", 1.3)}
          {note(300, 45, "STOP SITS JUST BEYOND INVALIDATION", "neutral")}
        </>
      );
    }
    case "rr-ladder": {
      return (
        <>
          {level(190, "accent")}
          {zone(120, 190, 380, 30, "bear")}
          {zone(120, 100, 380, 90, "bull")}
          {label(90, 205, "RISK 1", "bear", 0.9)}
          {label(90, 145, "REWARD 3", "bull", 1.1)}
          {line([[120, 190], [220, 178], [300, 150], [390, 120], [480, 102]], "bull")}
          {note(310, 60, "1 : 3 — WIN LESS OFTEN, STILL PROFIT", "accent")}
        </>
      );
    }
    case "no-trade": {
      return (
        <>
          {[85, 110, 135, 160, 185].map((y) => (
            <line key={y} x1={40} y1={y} x2={580} y2={y} stroke={NEUTRAL} strokeDasharray="2 5" opacity={0.35} />
          ))}
          {line([[60, 150], [110, 105], [170, 175], [230, 100], [290, 190], [350, 105], [420, 185], [480, 95], [540, 150]], "neutral", 2)}
          {label(300, 50, "NO CLEAN LEVEL", "bear", 1.0)}
          {label(300, 220, "BEST TRADE = NO TRADE", "accent", 1.4)}
        </>
      );
    }
    case "phase-map": {
      return (
        <>
          {zone(50, 40, 170, 190, "bull")}
          {zone(220, 40, 170, 190, "accent")}
          {zone(390, 40, 190, 190, "bear")}
          {line([[60, 210], [110, 185], [160, 150], [210, 115]], "bull")}
          {line([[225, 115], [265, 165], [305, 110], [345, 168], [385, 112]], "neutral", 2)}
          {line([[395, 115], [450, 145], [505, 175], [565, 205]], "bear")}
          {label(135, 245, "TREND", "bull", 0.9)}
          {label(305, 245, "RANGE", "accent", 1.1)}
          {label(485, 245, "REVERSE", "bear", 1.3)}
        </>
      );
    }
    case "stop-zones": {
      return (
        <>
          {level(140, "accent")}
          {line([[70, 175], [140, 160], [210, 168], [280, 140], [350, 118], [430, 105], [510, 85], [560, 70]], "bull")}
          {zone(60, 170, 520, 26, "bear")}
          {label(490, 183, "STOP BELOW STRUCTURE", "bear", 1.1)}
          {label(140, 128, "LEVEL", "accent", 1.0)}
          {note(300, 45, "NOT AT THE LEVEL. BEYOND IT.", "neutral")}
        </>
      );
    }
    case "target-zones": {
      return (
        <>
          {level(180, "accent")}
          {level(120, "bull")}
          {level(70, "bull")}
          {line([[70, 195], [150, 182], [230, 186], [310, 150], [390, 128], [470, 100], [545, 78]], "bull")}
          {label(520, 195, "ENTRY", "accent", 1.0)}
          {label(520, 135, "TP1 - PRIOR HIGH", "bull", 1.2)}
          {label(520, 55, "TP2 - MAJOR LEVEL", "bull", 1.4)}
        </>
      );
    }
    case "one-sentence": {
      return (
        <>
          {level(150, "accent")}
          {line([[70, 195], [140, 180], [210, 190], [280, 155], [350, 150], [420, 118], [490, 100], [550, 72]], "bull")}
          {dot(350, 150, "bull", 1.0)}
          {label(190, 138, "LEVEL", "accent", 1.0)}
          {label(350, 178, "REACTION", "bull", 1.2)}
          {label(500, 62, "TARGET", "bull", 1.4)}
          {note(300, 40, '"BUYING THE HOLD ABOVE THE LEVEL, STOP BELOW."', "neutral")}
        </>
      );
    }
    case "liquidity-pools": {
      return (
        <>
          {level(80, "bear")}
          {level(200, "bull")}
          {zone(60, 62, 520, 18, "bear")}
          {zone(60, 200, 520, 18, "bull")}
          {line([[70, 170], [140, 120], [210, 165], [280, 110], [350, 160], [420, 105], [500, 150], [555, 100]], "neutral", 2)}
          {label(500, 50, "SELL STOPS SIT HERE", "bear", 1.0)}
          {label(500, 232, "BUY STOPS SIT HERE", "bull", 1.3)}
        </>
      );
    }
    case "order-block": {
      const cs = [
        { x: 100, o: 170, h: 160, l: 180, c: 176 },
        { x: 145, o: 176, h: 168, l: 186, c: 182 },
        { x: 190, o: 182, h: 172, l: 192, c: 188 }, // last down candle
        { x: 235, o: 188, h: 110, l: 192, c: 118 }, // displacement up
        { x: 280, o: 118, h: 95, l: 125, c: 100 },
        { x: 325, o: 100, h: 92, l: 130, c: 126 },
        { x: 370, o: 126, h: 118, l: 178, c: 172 },
        { x: 415, o: 172, h: 120, l: 186, c: 126 },
        { x: 460, o: 126, h: 85, l: 132, c: 92 },
        { x: 505, o: 92, h: 62, l: 100, c: 70 },
      ];
      return (
        <>
          {zone(172, 170, 380, 24, "bull")}
          {cs.map((k, i) => candle(k.x, k.o, k.h, k.l, k.c, 16, i))}
          {label(200, 214, "ORDER BLOCK", "bull", 1.1)}
          {label(400, 205, "RETURN + BUY", "accent", 1.4)}
          {label(505, 45, "CONTINUATION", "bull", 1.6)}
        </>
      );
    }
    case "imbalance-gap": {
      const cs = [
        { x: 100, o: 190, h: 178, l: 200, c: 182 },
        { x: 150, o: 182, h: 170, l: 192, c: 176 },
        { x: 200, o: 176, h: 100, l: 180, c: 108 }, // big displacement leaves gap
        { x: 250, o: 108, h: 92, l: 116, c: 98 },
        { x: 300, o: 98, h: 90, l: 140, c: 136 },
        { x: 350, o: 136, h: 128, l: 158, c: 152 }, // fills gap
        { x: 400, o: 152, h: 108, l: 158, c: 114 },
        { x: 450, o: 114, h: 80, l: 120, c: 86 },
        { x: 500, o: 86, h: 64, l: 94, c: 70 },
      ];
      return (
        <>
          {zone(180, 128, 380, 44, "accent")}
          {cs.map((k, i) => candle(k.x, k.o, k.h, k.l, k.c, 16, i))}
          {label(230, 195, "IMBALANCE / GAP", "accent", 1.1)}
          {label(400, 195, "FILLED", "bull", 1.5)}
        </>
      );
    }
    case "intent-map": {
      return (
        <>
          {level(140, "accent")}
          {/* building */}
          {candle(90, 155, 140, 168, 150, 14, 0)}
          {candle(125, 150, 138, 162, 152, 14, 1)}
          {candle(160, 152, 141, 165, 148, 14, 2)}
          {label(125, 195, "BUILDING", "neutral", 1.0)}
          {/* breaking */}
          {candle(370, 150, 142, 155, 145, 14, 3)}
          {candle(405, 145, 95, 150, 102, 14, 4)}
          {candle(440, 102, 78, 110, 84, 14, 5)}
          {label(415, 195, "BREAKING", "bull", 1.3)}
          {note(300, 45, "SLOW GRIND = INDECISION. ONE BIG PUSH = INTENT.", "neutral")}
        </>
      );
    }
    case "displacement": {
      const cs = [
        { x: 100, o: 190, h: 180, l: 200, c: 186 },
        { x: 150, o: 186, h: 176, l: 196, c: 190 },
        { x: 200, o: 190, h: 182, l: 198, c: 188 },
        { x: 250, o: 188, h: 80, l: 194, c: 90 },
        { x: 300, o: 90, h: 68, l: 100, c: 76 },
        { x: 350, o: 76, h: 66, l: 104, c: 98 },
        { x: 400, o: 98, h: 88, l: 112, c: 92 },
        { x: 450, o: 92, h: 60, l: 98, c: 66 },
        { x: 500, o: 66, h: 48, l: 74, c: 54 },
      ];
      return (
        <>
          {zone(228, 80, 44, 115, "bull")}
          {cs.map((k, i) => candle(k.x, k.o, k.h, k.l, k.c, 16, i))}
          {label(250, 215, "DISPLACEMENT", "bull", 1.1)}
          {label(430, 195, "FAIR VALUE RETURN", "accent", 1.4)}
          {note(300, 40, "BIG CANDLE = REAL PARTICIPATION", "neutral")}
        </>
      );
    }
    case "pre-trade":
    case "candles-generic":

    default: {
      const cs = [
        { x: 70,  o: 190, h: 170, l: 210, c: 175 },
        { x: 110, o: 175, h: 160, l: 190, c: 165 },
        { x: 150, o: 165, h: 155, l: 185, c: 178 },
        { x: 190, o: 178, h: 150, l: 190, c: 155 },
        { x: 230, o: 155, h: 130, l: 168, c: 140 },
        { x: 270, o: 140, h: 120, l: 155, c: 125 },
        { x: 310, o: 125, h: 100, l: 138, c: 108 },
        { x: 350, o: 108, h: 85,  l: 120, c: 90  },
        { x: 390, o: 90,  h: 70,  l: 100, c: 75  },
        { x: 430, o: 75,  h: 60,  l: 100, c: 95  },
        { x: 470, o: 95,  h: 80,  l: 110, c: 85  },
        { x: 510, o: 85,  h: 65,  l: 105, c: 70  },
        { x: 550, o: 70,  h: 55,  l: 90,  c: 60  },
      ];
      return <>{cs.map((k) => candle(k.x, k.o, k.h, k.l, k.c, 14))}</>;
    }
  }
}
