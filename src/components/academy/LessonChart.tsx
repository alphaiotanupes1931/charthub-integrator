import type { LessonChartType } from "@/lib/academy-content";

/**
 * Small illustrative SVG diagrams used inside academy lesson callouts.
 * All diagrams share the same viewBox + palette so they feel cohesive.
 */
export function LessonChart({ type }: { type: LessonChartType }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-3 sm:p-4">
      <svg viewBox="0 0 600 260" className="w-full h-auto" role="img" aria-label={type}>
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

function label(x: number, y: number, text: string, tone: "bull" | "bear" | "accent" = "accent") {
  const bg = tone === "bull" ? BULL : tone === "bear" ? BEAR : ACCENT;
  const w = Math.max(text.length * 6.5 + 14, 60);
  return (
    <g>
      <rect x={x - w / 2} y={y - 12} width={w} height={20} rx={10} fill={`${bg}22`} stroke={bg} strokeWidth={1} />
      <text x={x} y={y + 2} fontSize="10" fontWeight="700" textAnchor="middle" fill={bg}>{text}</text>
    </g>
  );
}

function candle(x: number, o: number, h: number, l: number, c: number, w = 12) {
  const bull = c < o; // in SVG lower y = higher price; keep intuitive
  const color = bull ? BULL : BEAR;
  const top = Math.min(o, c);
  const bot = Math.max(o, c);
  return (
    <g key={`c-${x}`}>
      <line x1={x} y1={h} x2={x} y2={l} stroke={color} strokeWidth={1.2} />
      <rect x={x - w / 2} y={top} width={w} height={Math.max(bot - top, 2)} fill={color} opacity={0.85} />
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
    case "pre-trade":
    case "phase-map":
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
