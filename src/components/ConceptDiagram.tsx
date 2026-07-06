import type { ReactElement } from "react";
import { X } from "lucide-react";
import { CONCEPT_LABELS, type ConceptId, type ConceptRef } from "@/lib/chartAnnotations";

// Small schematic SVG diagrams for trading concepts. Purely illustrative - not
// tied to live prices. Used when the AI emits a ```concept-diagram block or the
// user opens the concept panel from the chart.

const stroke = "#e2e8f0";
const bull = "#34d399";
const bear = "#f87171";
const accent = "#fbbf24";
const dim = "#64748b";

function Candle({ x, top, bot, open, close, w = 10 }: { x: number; top: number; bot: number; open: number; close: number; w?: number }) {
  const up = close < open; // svg y grows down; "up" bar closes above open (lower y)
  const bodyTop = Math.min(open, close);
  const bodyBot = Math.max(open, close);
  const color = up ? bull : bear;
  return (
    <g>
      <line x1={x + w / 2} x2={x + w / 2} y1={top} y2={bot} stroke={color} strokeWidth={1.2} />
      <rect x={x} y={bodyTop} width={w} height={Math.max(2, bodyBot - bodyTop)} fill={color} />
    </g>
  );
}

function Frame({ children, title, note }: { children: React.ReactNode; title: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">{title}</div>
        {note && <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{note}</div>}
      </div>
      <div className="w-full overflow-hidden rounded bg-muted/30 p-2">
        <svg viewBox="0 0 260 140" className="w-full h-auto">
          {children}
        </svg>
      </div>
    </div>
  );
}

function FVGDiagram() {
  return (
    <Frame title="Fair Value Gap (FVG)" note="3-candle imbalance">
      {/* three candles, gap between 1st high and 3rd low */}
      <Candle x={40}  top={70} bot={125} open={110} close={80} />
      <Candle x={100} top={30} bot={110} open={95}  close={45} />
      <Candle x={160} top={20} bot={90}  open={70}  close={30} />
      {/* imbalance shaded */}
      <rect x={20} y={45} width={220} height={25} fill={bull} fillOpacity={0.18} stroke={bull} strokeDasharray="3 3" />
      <text x={22} y={41} fontSize={9} fill={bull}>Bullish FVG (unfilled imbalance)</text>
      <text x={22} y={135} fontSize={8} fill={dim}>Price often returns to fill this gap.</text>
    </Frame>
  );
}

function OrderBlockDiagram() {
  return (
    <Frame title="Order Block" note="Last opposing candle before impulse">
      <Candle x={30}  top={60}  bot={110} open={95}  close={100} />
      <Candle x={60}  top={55}  bot={115} open={105} close={110} />
      {/* down candle (the OB) */}
      <Candle x={90}  top={50}  bot={118} open={70}  close={112} />
      {/* strong impulse up */}
      <Candle x={120} top={25}  bot={95}  open={90}  close={30} />
      <Candle x={150} top={20}  bot={60}  open={55}  close={25} />
      <Candle x={180} top={18}  bot={45}  open={40}  close={22} />
      <rect x={80} y={70} width={160} height={48} fill={bull} fillOpacity={0.16} stroke={bull} strokeDasharray="3 3" />
      <text x={82} y={66} fontSize={9} fill={bull}>Bullish OB (return zone)</text>
    </Frame>
  );
}

function LiquiditySweepDiagram() {
  return (
    <Frame title="Liquidity Sweep" note="Stop hunt then reversal">
      <line x1={20} x2={240} y1={55} y2={55} stroke={accent} strokeDasharray="4 3" />
      <text x={22} y={50} fontSize={9} fill={accent}>Equal highs (liquidity)</text>
      <Candle x={40}  top={60} bot={110} open={100} close={70} />
      <Candle x={70}  top={55} bot={100} open={90}  close={65} />
      {/* wick sweeps above */}
      <line x1={105} x2={105} y1={42} y2={110} stroke={bear} strokeWidth={1.2} />
      <rect x={100} y={70} width={10} height={38} fill={bear} />
      <Candle x={130} top={70} bot={118} open={78}  close={112} />
      <Candle x={160} top={80} bot={125} open={90}  close={120} />
      <Candle x={190} top={90} bot={130} open={100} close={125} />
      <path d="M 110 45 Q 150 45 190 100" fill="none" stroke={bear} strokeWidth={1.2} markerEnd="" />
      <text x={135} y={60} fontSize={9} fill={bear}>Reversal</text>
    </Frame>
  );
}

function BOSDiagram() {
  return (
    <Frame title="Break of Structure (BOS)" note="Trend continuation">
      <path d="M 20 110 L 60 60 L 90 90 L 130 50 L 160 80 L 200 30 L 240 55" fill="none" stroke={stroke} strokeWidth={1.4} />
      <line x1={20} x2={240} y1={50} y2={50} stroke={accent} strokeDasharray="3 3" />
      <text x={22} y={46} fontSize={9} fill={accent}>Previous high</text>
      <circle cx={200} cy={30} r={4} fill={bull} />
      <text x={205} y={28} fontSize={9} fill={bull}>BOS ↑ (new HH)</text>
    </Frame>
  );
}

function CHoCHDiagram() {
  return (
    <Frame title="Change of Character (CHoCH)" note="Trend reversal">
      <path d="M 20 30 L 60 70 L 90 45 L 130 90 L 160 60 L 200 110 L 240 90" fill="none" stroke={stroke} strokeWidth={1.4} />
      <line x1={20} x2={240} y1={70} y2={70} stroke={accent} strokeDasharray="3 3" />
      <text x={22} y={66} fontSize={9} fill={accent}>Prior HL</text>
      <circle cx={200} cy={110} r={4} fill={bear} />
      <text x={155} y={125} fontSize={9} fill={bear}>CHoCH ↓ (breaks HL)</text>
    </Frame>
  );
}

function FibDiagram() {
  const y0 = 25, y1 = 115;
  const ratios: Array<[number, string]> = [[0, "0"],[0.382, "0.382"],[0.5, "0.5"],[0.618, "0.618"],[1, "1"]];
  return (
    <Frame title="Fibonacci Retracement" note="Key retracement levels">
      <line x1={30} x2={30} y1={y0} y2={y1} stroke={accent} strokeWidth={1.2} />
      {ratios.map(([r, l]) => {
        const y = y0 + (y1 - y0) * r;
        return (
          <g key={l}>
            <line x1={30} x2={240} y1={y} y2={y} stroke={accent} strokeOpacity={0.5} strokeDasharray="2 3" />
            <text x={244} y={y + 3} fontSize={8} fill={accent}>{l}</text>
          </g>
        );
      })}
      <path d="M 30 115 L 120 25 L 210 80" fill="none" stroke={stroke} strokeWidth={1.4} />
      <circle cx={210} cy={80} r={3} fill={bull} />
    </Frame>
  );
}

function SRDiagram() {
  return (
    <Frame title="Support & Resistance" note="Repeated reactions">
      <line x1={20} x2={240} y1={35} y2={35} stroke={bear} strokeDasharray="3 3" />
      <text x={22} y={31} fontSize={9} fill={bear}>Resistance</text>
      <line x1={20} x2={240} y1={110} y2={110} stroke={bull} strokeDasharray="3 3" />
      <text x={22} y={122} fontSize={9} fill={bull}>Support</text>
      <path d="M 25 100 L 60 40 L 95 105 L 130 45 L 165 100 L 200 40 L 235 95" fill="none" stroke={stroke} strokeWidth={1.4} />
    </Frame>
  );
}

function WyckoffDiagram() {
  return (
    <Frame title="Wyckoff Accumulation" note="PS · SC · AR · ST · Spring · LPS · SOS">
      <path d="M 20 40 L 45 90 L 70 60 L 100 100 L 130 55 L 155 115 L 180 70 L 210 30 L 240 45" fill="none" stroke={stroke} strokeWidth={1.4} />
      <line x1={20} x2={240} y1={50} y2={50} stroke={accent} strokeOpacity={0.7} strokeDasharray="3 3" />
      <line x1={20} x2={240} y1={105} y2={105} stroke={bull} strokeOpacity={0.7} strokeDasharray="3 3" />
      <circle cx={155} cy={115} r={4} fill={bull} />
      <text x={160} y={128} fontSize={9} fill={bull}>Spring</text>
      <circle cx={210} cy={30} r={4} fill={bull} />
      <text x={175} y={22} fontSize={9} fill={bull}>SOS (breakout)</text>
    </Frame>
  );
}

const REGISTRY: Record<ConceptId, () => ReactElement> = {
  FVG: FVGDiagram,
  OrderBlock: OrderBlockDiagram,
  LiquiditySweep: LiquiditySweepDiagram,
  BOS: BOSDiagram,
  CHoCH: CHoCHDiagram,
  Fib: FibDiagram,
  SR: SRDiagram,
  Wyckoff: WyckoffDiagram,
};

export function ConceptDiagram({ concept }: { concept: ConceptRef }) {
  const Comp = REGISTRY[concept.id];
  if (!Comp) return null;
  return (
    <div className="space-y-1">
      <Comp />
      {concept.note && (
        <div className="text-[11px] text-muted-foreground px-1">{concept.note}</div>
      )}
    </div>
  );
}

export function ChartConceptOverlay({ concept, onClose }: { concept: ConceptRef; onClose: () => void }) {
  return (
    <div className="absolute right-3 bottom-3 z-30 w-[280px] max-w-[80%] rounded-xl border border-border bg-background/95 backdrop-blur shadow-2xl">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Concept · {CONCEPT_LABELS[concept.id] ?? concept.id}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
          aria-label="Close concept diagram"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-2">
        <ConceptDiagram concept={concept} />
      </div>
    </div>
  );
}
