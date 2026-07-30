import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { NativeChart, LEVEL_META, type LevelKey, type ChartSnapshot } from "@/components/NativeChart";

import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";
import { ChevronDown, Crosshair, Loader2, Check, Activity, LayoutGrid, Clock, MessageSquare, X, Plug, Maximize2, Square, Paperclip, ChevronUp, PanelRightClose, PanelRightOpen, BarChart3, ThumbsUp, ThumbsDown, Brain, LineChart, Settings2, Maximize, Minimize, BookOpen } from "lucide-react";


import { useCoachVoice } from "@/hooks/useCoachVoice";
import { DashboardChatPanel, type DashboardChatHandle } from "@/components/DashboardChatPanel";
import { ChartConceptOverlay } from "@/components/ConceptDiagram";
import { ChartSignalCards } from "@/components/ChartSignalCards";
import { TodaysRecommendation } from "@/components/TodaysRecommendation";
import { SCAN_LENSES, readActiveLensId, writeActiveLensId, findLens, type ScanLensId } from "@/lib/scanLens";
import { readActiveCoach, writeActiveCoach, COACH_KEY, writeLastChart } from "@/lib/chat-client";
import { voiceForCoach } from "@/lib/coachVoices";
import { COACH_ICON_META, DEFAULT_COACH_ICON } from "@/lib/coachMeta";
import { runResearchPlan } from "@/lib/agents/research.functions";
import { recordHermesFeedback } from "@/lib/agents/hermes.functions";
import { listChatThreads, createChatThread, deleteChatThread, getActiveModel, type ActiveModelInfo } from "@/lib/chat.functions";
import type { ResearchMemo, OrderFlow } from "@/lib/agents/types";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";


type DashboardSearch = { ask?: string; symbol?: string };

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard, TradeMind" },
      { name: "description", content: "Live chart and AI setup analysis for your active instrument." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): DashboardSearch => ({
    ask: typeof s.ask === "string" ? s.ask : undefined,
    symbol: typeof s.symbol === "string" ? s.symbol : undefined,
  }),
  component: Dashboard,
});

const INTERVALS = [
  { label: "1m",  value: "1"   },
  { label: "5m",  value: "5"   },
  { label: "15m", value: "15"  },
  { label: "1H",  value: "60"  },
  { label: "4H",  value: "240" },
  { label: "1D",  value: "D"   },
  { label: "1W",  value: "W"   },
  { label: "1M",  value: "M"   },
];

type Symbol = { tv: string; ticker: string; name: string; venue: string };

function symbolLabel(s: Symbol) {
  // Human-friendly label used in AI prompts so the assistant refers to the
  // instrument the trader sees on the chart (e.g. "Gold" instead of "XAU/USD").
  return s.name ? `${s.name} (${s.ticker})` : s.ticker;
}

function historyInstrumentTitle(s: Symbol) {
  const key = s.ticker.toUpperCase().replace("/", "");
  const nice: Record<string, string> = {
    XAUUSD: "XAU Gold",
    XAGUSD: "XAG Silver",
    BTCUSD: "BTC",
    ETHUSD: "ETH",
    XRPUSD: "XRP",
    NAS100: "NAS100",
    US30: "US30",
    SPX500: "SPX500",
    "WTI OIL": "WTI Oil",
  };
  return nice[key] ?? key;
}

// Guard: any scan prompt must reference the symbol currently shown on the chart.
// If the prompt is missing the friendly name or the ticker, we warn loudly so the
// mismatch can never silently ship (e.g. "analyzing XAU/USD" while viewing Gold,
// or scanning Silver while Gold is loaded).
function assertScanPromptMatchesSymbol(prompt: string, symbol: Symbol, ctx: string) {
  const p = prompt.toLowerCase();
  const missing: string[] = [];
  if (symbol.name && !p.includes(symbol.name.toLowerCase())) missing.push(`name "${symbol.name}"`);
  if (symbol.ticker && !p.includes(symbol.ticker.toLowerCase())) missing.push(`ticker "${symbol.ticker}"`);

  // Detect a foreign symbol slipping into the prompt (e.g. Gold prompt mentioning EUR/USD).
  const foreign = SYMBOLS.find(
    (s) =>
      s.tv !== symbol.tv &&
      (p.includes(s.ticker.toLowerCase()) ||
        (s.name && p.includes(s.name.toLowerCase()))),
  );

  if (missing.length === 0 && !foreign) return true;

  const detail = [
    missing.length ? `missing ${missing.join(", ")}` : null,
    foreign ? `references other symbol "${foreign.ticker}"` : null,
  ]
    .filter(Boolean)
    .join("; ");

  const msg = `Scan/symbol mismatch (${ctx}): chart is ${symbolLabel(symbol)} [${symbol.tv}] but prompt ${detail}.`;
  console.warn("[scan-guard]", msg, { prompt, symbol });
  toast.warning("Scan/symbol mismatch", {
    description: `Chart is ${symbolLabel(symbol)} but the scan prompt ${detail}.`,
  });
  return false;
}


const SYMBOLS: Symbol[] = [
  { tv: "OANDA:XAUUSD",      ticker: "XAU/USD", name: "Gold Spot",        venue: "OANDA"     },
  { tv: "OANDA:XAGUSD",      ticker: "XAG/USD", name: "Silver Spot",      venue: "OANDA"     },
  { tv: "FOREXCOM:NSXUSD",   ticker: "NAS100",  name: "US Nasdaq 100",    venue: "FOREX.com" },
  { tv: "FOREXCOM:DJI",      ticker: "US30",    name: "Dow Jones",        venue: "FOREX.com" },
  { tv: "FOREXCOM:SPXUSD",   ticker: "SPX500",  name: "S&P 500",          venue: "FOREX.com" },
  { tv: "TVC:USOIL",         ticker: "WTI Oil", name: "US Crude Oil",     venue: "TVC"       },
  { tv: "FX:EURUSD",         ticker: "EUR/USD", name: "Euro / Dollar",    venue: "FX"        },
  { tv: "FX:GBPUSD",         ticker: "GBP/USD", name: "Pound / Dollar",   venue: "FX"        },
  { tv: "FX:USDJPY",         ticker: "USD/JPY", name: "Dollar / Yen",     venue: "FX"        },
  { tv: "BINANCE:BTCUSDT",   ticker: "BTC/USD", name: "Bitcoin",          venue: "Binance"   },
  { tv: "BINANCE:ETHUSDT",   ticker: "ETH/USD", name: "Ethereum",         venue: "Binance"   },
  { tv: "BINANCE:XRPUSDT",   ticker: "XRP/USD", name: "Ripple",           venue: "Binance"   },
];

// Resolve a chat-history "symbol" tag (e.g. "XAU Gold", "SPX500", "BTC")
// back to a SYMBOLS entry so clicking a past chat can switch the chart.
function findSymbolFromTag(tag?: string | null): Symbol | null {
  if (!tag) return null;
  const norm = tag.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const map: Record<string, string> = {
    XAUGOLD: "XAU/USD", XAU: "XAU/USD", GOLD: "XAU/USD", XAUUSD: "XAU/USD",
    XAGSILVER: "XAG/USD", XAG: "XAG/USD", SILVER: "XAG/USD", XAGUSD: "XAG/USD",
    BTC: "BTC/USD", BTCUSD: "BTC/USD",
    ETH: "ETH/USD", ETHUSD: "ETH/USD",
    XRP: "XRP/USD", XRPUSD: "XRP/USD",
    NAS100: "NAS100", NDX: "NAS100", QQQ: "NAS100",
    US30: "US30", DJI: "US30", DIA: "US30",
    SPX500: "SPX500", SPX: "SPX500", GSPC: "SPX500", SPY: "SPX500",
    WTIOIL: "WTI Oil", WTI: "WTI Oil", OIL: "WTI Oil",
    EURUSD: "EUR/USD", GBPUSD: "GBP/USD", USDJPY: "USD/JPY",
  };
  const ticker = map[norm];
  if (!ticker) return null;
  return SYMBOLS.find((s) => s.ticker === ticker) ?? null;
}

type ScanResult = {
  grade: "A+" | "A" | "B" | "C" | "NO ENTRY";
  bias: "Long" | "Short" | "Neutral";
  confidence: number;
  notes: string;
  entry: string;
  stop: string;
  tp1: string;
  tp2: string;
  rr: string;
  details: string;
  memo?: ResearchMemo;
  orderFlow?: OrderFlow;
  dailyBias?: "bullish" | "bearish" | "neutral";
  currentTrend?: "up" | "down" | "range";
  synopsis?: string;
};

function fmtPrice(n: number, decimals: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function decimalsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  return 5;
}

function gradeFor(symbol: Symbol, lastPrice?: number): ScanResult {
  let h = 0;
  for (let i = 0; i < symbol.tv.length; i++) h = (h * 31 + symbol.tv.charCodeAt(i)) >>> 0;
  const grades: ScanResult["grade"][] = ["A+", "A", "B", "C", "NO ENTRY"];
  const grade = grades[h % grades.length];
  const bias = (["Long", "Short", "Neutral"] as const)[(h >> 4) % 3];
  const confidence = 55 + ((h >> 8) % 40);
  const notesByGrade: Record<ScanResult["grade"], string> = {
    "A+": "Sweep then BOS confirmed. Clean retest forming. Stop is structurally tight.",
    A:   "Strong Phase D setup. Wait for first 5m close back inside range before entry.",
    B:   "Confluence is partial. R:R only justifies a half size.",
    C:   "Choppy structure. Liquidity above and below. Skip until one side resolves.",
    "NO ENTRY": "No edge. Range mid with conflicting HTF bias. Stand down.",
  };
  // Build plan numbers - anchored to lastPrice when we have it; otherwise illustrative.
  const px = typeof lastPrice === "number" && isFinite(lastPrice) ? lastPrice : 100;
  const dec = decimalsFor(px);
  const stopPct = 0.004 + ((h >> 12) % 7) / 1000; // 0.4% - 1.1%
  const tp1R = 1.5;
  const tp2R = 3;
  let entry = px;
  let stop: number;
  let tp1: number;
  let tp2: number;
  if (bias === "Long") {
    stop = px * (1 - stopPct);
    const risk = entry - stop;
    tp1 = entry + risk * tp1R;
    tp2 = entry + risk * tp2R;
  } else if (bias === "Short") {
    stop = px * (1 + stopPct);
    const risk = stop - entry;
    tp1 = entry - risk * tp1R;
    tp2 = entry - risk * tp2R;
  } else {
    stop = px * (1 - stopPct);
    tp1 = px * (1 + stopPct * tp1R);
    tp2 = px * (1 + stopPct * tp2R);
  }
  return {
    grade,
    bias,
    confidence,
    notes: notesByGrade[grade],
    entry: fmtPrice(entry, dec),
    stop: fmtPrice(stop, dec),
    tp1: fmtPrice(tp1, dec),
    tp2: fmtPrice(tp2, dec),
    rr: `1 : ${tp2R}`,
    details: `Trigger: ${bias === "Neutral" ? "wait for a sweep + BOS in either direction" : `${bias.toLowerCase()} on a 5m close back through the retest`}. Invalidation: ${bias === "Long" ? "close below" : bias === "Short" ? "close above" : "structural break of"} ${fmtPrice(stop, dec)}. Manage to break-even at TP1 (${fmtPrice(tp1, dec)}), trail the runner toward TP2 (${fmtPrice(tp2, dec)}). Risk fixed at 0.5-1R of account.`,
  };
}

const gradeColor: Record<ScanResult["grade"], string> = {
  "A+": "text-primary",
  A:   "text-bull",
  B:   "text-foreground/80",
  C:   "text-destructive",
  "NO ENTRY": "text-destructive",
};

function ScreenshotAttach({ onPick }: { onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:border-primary/50 transition"
        title="Upload or paste a chart screenshot for the AI to scan"
      >
        <Paperclip className="h-3.5 w-3.5" /> Scan a screenshot
      </button>
    </>
  );
}

function ScanTicket({
  result, symbol, onRescan, onAttach, onStopVoice, voiceSpeaking,
}: {
  result: ScanResult;
  symbol: Symbol;
  lensId: ScanLensId;
  onRescan: () => void;
  onAttach: (file: File) => void;
  onStopVoice: () => void;
  voiceSpeaking: boolean;
}) {
  const isNoEntry = result.grade === "NO ENTRY";

  // Compact volume / order-flow read from the research memo. The written
  // narrative (strength/weakness, coach reasoning) lives in the chat panel;
  // this card stays purely numeric and glanceable.
  const notes = result.memo?.notes ?? [];
  const techNote = notes.find((n) => n.role === "technical");
  const macroNote = notes.find((n) => n.role === "macro");
  const sentNote = notes.find((n) => n.role === "sentiment");
  const riskNote = notes.find((n) => n.role === "risk");

  // Trend strength: convert consensus bias + confidence to a bullish %.
  const consensus = result.memo?.consensus ?? (result.bias === "Long" ? "bullish" : result.bias === "Short" ? "bearish" : "neutral");
  const consensusConf = result.memo?.consensusConfidence ?? result.confidence;
  const bullishPct = consensus === "bullish"
    ? Math.round(50 + consensusConf / 2)
    : consensus === "bearish"
    ? Math.round(50 - consensusConf / 2)
    : 50;
  const bearishPct = 100 - bullishPct;
  const trendLabel = bullishPct >= 65 ? "Strongly bullish" : bullishPct >= 55 ? "Leaning bullish" : bullishPct <= 35 ? "Strongly bearish" : bullishPct <= 45 ? "Leaning bearish" : "Balanced";

  // Order flow: technical analyst read.
  const flowBias = techNote?.bias ?? consensus;
  const flowStrength = techNote?.confidence ?? consensusConf;
  const flowLabel = flowBias === "bullish" ? "Buyers in control" : flowBias === "bearish" ? "Sellers in control" : "Balanced";

  // Volume: use range20Pct and 24h change as a proxy for participation.
  const volumeTag = flowStrength >= 70 ? "High" : flowStrength >= 45 ? "Medium" : "Light";

  // Volatility from risk analyst.
  const volatilityConf = riskNote?.confidence ?? 50;
  const volatilityTag = volatilityConf >= 65 ? "Elevated" : volatilityConf >= 40 ? "Normal" : "Quiet";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2 truncate">
            {symbol.ticker} · {result.bias}
          </div>
          <div className={`font-display text-4xl sm:text-6xl leading-none tracking-tight ${gradeColor[result.grade]}`}>
            {result.grade}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {voiceSpeaking && (
            <button
              onClick={onStopVoice}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/15"
              title="Stop voice"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
          <button
            onClick={onRescan}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition whitespace-nowrap"
            title="Run a new scan on the current chart"
          >
            <Crosshair className="h-3 w-3" /> New scan
          </button>
          {!isNoEntry && (
            <button
              onClick={() => {
                const parseNum = (v: string) => {
                  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
                  return Number.isFinite(n) ? n : undefined;
                };
                const prefill = {
                  symbol: symbol.ticker,
                  side: result.bias === "Short" ? "Short" : "Long",
                  entry: parseNum(result.entry),
                  stop: parseNum(result.stop),
                  tp1: parseNum(result.tp1),
                  tp2: parseNum(result.tp2),
                  setup: `Scan ${result.grade}`,
                  notes: `Auto-logged from TradeMind scan. Grade ${result.grade}, ${result.bias}, confidence ${result.confidence}%, R:R ${result.rr}.`,
                };
                try { localStorage.setItem("trademind.journal.prefill.v1", JSON.stringify(prefill)); } catch { /* ignore */ }
                window.location.assign("/journal");
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 whitespace-nowrap"
              title="Log this setup to your trade journal"
            >
              <BookOpen className="h-3 w-3" /> Log to Journal
            </button>
          )}
        </div>

      </div>

      {!isNoEntry && (
        <div className="grid grid-cols-2 gap-2">
          <TicketCell label="Entry" value={result.entry} />
          <TicketCell label="Stop"  value={result.stop} tone="bad" />
          <TicketCell label="TP1"   value={result.tp1} tone="good" />
          <TicketCell label="TP2"   value={result.tp2} tone="good" />
        </div>
      )}

      <div>
        <div className="flex justify-between text-[11px] mb-2">
          <span className="text-muted-foreground">Confidence · R:R {result.rr}</span>
          <span className="text-primary font-semibold">{result.confidence}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
          <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${result.confidence}%` }} />
        </div>
      </div>

      {/* Trend meter - visual bullish vs bearish split */}
      <div>
        <div className="flex justify-between items-baseline text-[11px] mb-2">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Trend</span>
          <span className="font-semibold text-foreground">{trendLabel}</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-border/40">
          <div className="bg-bull transition-[width] duration-500" style={{ width: `${bullishPct}%` }} />
          <div className="bg-red-500 transition-[width] duration-500" style={{ width: `${bearishPct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1 font-mono">
          <span className="text-bull">{bullishPct}% bullish</span>
          <span className="text-red-400">{bearishPct}% bearish</span>
        </div>
      </div>

      {/* Volume snapshot */}
      <MetricBlock title="Volume" tag={volumeTag} tone={flowStrength >= 45 ? "neutral" : "muted"}>
        <MetricRow label="Participation" value={`${Math.round(flowStrength)}%`} />
        
        {sentNote && <MetricRow label="Sentiment" value={`${sentNote.bias} · ${Math.round(sentNote.confidence)}%`} />}
      </MetricBlock>

      {/* Order flow snapshot */}
      <MetricBlock title="Order Flow" tag={flowLabel} tone={flowBias === "bullish" ? "good" : flowBias === "bearish" ? "bad" : "neutral"}>
        <MetricRow label="Directional strength" value={`${Math.round(flowStrength)}%`} />
        {techNote?.keyLevels && techNote.keyLevels.length > 0 && (
          <MetricRow label="Key levels" value={techNote.keyLevels.slice(0, 3).map((n) => n.toLocaleString()).join(", ")} />
        )}
        {macroNote && <MetricRow label="Macro" value={`${macroNote.bias} · ${Math.round(macroNote.confidence)}%`} />}
      </MetricBlock>

      {/* Volatility */}
      <MetricBlock title="Volatility" tag={volatilityTag} tone={volatilityConf >= 65 ? "bad" : "neutral"}>
        <MetricRow label="Risk read" value={`${Math.round(volatilityConf)}%`} />
        {riskNote?.summary && <MetricRow label="Note" value={riskNote.summary.slice(0, 80)} />}
      </MetricBlock>

      <p className="text-[11px] text-muted-foreground text-center">
        Read the full breakdown in the Chat tab.
      </p>

      <div className="pt-1 flex justify-center">
        <ScreenshotAttach onPick={onAttach} />
      </div>
    </div>
  );
}

function MetricBlock({ title, tag, tone = "neutral", children }: { title: string; tag: string; tone?: "good" | "bad" | "neutral" | "muted"; children: React.ReactNode }) {
  const tagColor = tone === "good" ? "text-bull border-bull/40 bg-bull/10"
    : tone === "bad" ? "text-red-400 border-red-500/40 bg-red-500/10"
    : tone === "muted" ? "text-muted-foreground border-border bg-muted/20"
    : "text-primary border-primary/40 bg-primary/10";
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{title}</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider rounded border px-1.5 py-0.5 ${tagColor}`}>{tag}</span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, hidden }: { label: string; value: string; hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground text-right truncate">{value}</span>
    </div>
  );
}


function TicketCell({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-bull" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

const ALL_LEVELS: LevelKey[] = ["VWAP","POC","SR","ZONES","FVG","FIB","LIQ","OF","CISD"];

const STORAGE_KEY = "trademind.levels.enabled.v3";
const SESSIONS_STORAGE_KEY = "trademind.sessions.enabled.v1";

const DEFAULT_LEVELS: Record<LevelKey, boolean> = { VWAP: false, POC: false, SR: false, ZONES: false, FVG: false, FIB: false, LIQ: false, OF: false, CISD: false };

function loadLevels(): Record<LevelKey, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LEVELS };
    return { ...DEFAULT_LEVELS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_LEVELS }; }
}

function loadSessionsOn(): boolean {
  try {
    const raw = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
    return raw === "true";
  } catch { return false; }
}

function Dashboard() {
  const voice = useCoachVoice();
  const [interval, setIntervalState] = useState("60");
  const [symbol, setSymbol] = useState<Symbol>(SYMBOLS[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(`trademind.scanResult.${SYMBOLS[0].ticker}`);
      return raw ? (JSON.parse(raw) as ScanResult) : null;
    } catch { return null; }
  });

  const [levelsOpen, setLevelsOpen] = useState(false);

  
  const [levels, setLevels] = useState<Record<LevelKey, boolean>>(() =>
    typeof window !== "undefined" ? loadLevels() : { ...DEFAULT_LEVELS },
  );
  const [sessionsOn, setSessionsOn] = useState(() =>
    typeof window !== "undefined" ? loadSessionsOn() : false,
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(Date.now());

  const [lastUpdatedText, setLastUpdatedText] = useState<string>("");

  // Persist scan result per symbol so switching tabs/symbols keeps the last analysis visible.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(`trademind.scanResult.${symbol.ticker}`);
      setResult(raw ? (JSON.parse(raw) as ScanResult) : null);
    } catch { setResult(null); }
  }, [symbol.ticker]);

  // Clear any stale AI signal/annotations when the user switches symbols so
  // the previous ticker's grade card doesn't hang over the new chart.
  useEffect(() => {
    setAiGrade(null);
    setAiAnnotationsRaw([]);
    setAiConcept(null);
  }, [symbol.ticker]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (result) window.sessionStorage.setItem(`trademind.scanResult.${symbol.ticker}`, JSON.stringify(result));
    } catch { /* ignore */ }
  }, [result, symbol.ticker]);


  useEffect(() => {
    if (!lastUpdatedAt) {
      setLastUpdatedText("");
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 60000));
      setLastUpdatedText(diff === 0 ? "just now" : `${diff} min ago`);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [lastUpdatedAt]);

  const [rightTab, setRightTab] = useState<"analysis" | "chat">("analysis");
  const [activeModel, setActiveModel] = useState<ActiveModelInfo | null>(null);
  const getModel = useServerFn(getActiveModel);
  useEffect(() => {
    getModel().then(setActiveModel).catch(() => setActiveModel(null));
  }, [getModel]);
  const [chatPanelView, setChatPanelView] = useState<"conversation" | "history">("conversation");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<"narrow" | "default" | "wide">("default");

  const [chartTab, setChartTab] = useState<"live" | "setup">("live");
  // Mobile-only: which pane is visible full-height (chart / scan / chat). On >=lg
  // both are shown side-by-side and this state is ignored.
  const [mobileView, setMobileView] = useState<"chart" | "scan" | "chat">("chart");
  const [candleType, setCandleType] = useState<"candle" | "ha">("candle");
  const [snapshot, setSnapshot] = useState<ChartSnapshot | null>(null);
  const [aiAnnotationsRaw, setAiAnnotationsRaw] = useState<import("@/lib/chartAnnotations").ChartAnnotation[]>([]);
  const [aiConcept, setAiConcept] = useState<import("@/lib/chartAnnotations").ConceptRef | null>(null);
  const [aiGrade, setAiGrade] = useState<import("@/lib/chartAnnotations").ChartGrade | null>(null);

  // Full-screen chart toggle
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsChartFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleChartFullscreen = async () => {
    try {
      const el = chartAreaRef.current;
      if (!el) return;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (e) {
      console.error("Fullscreen toggle failed", e);
    }
  };

  // Reject AI prices that are wildly outside the current price (>8%).
  const aiAnnotations = useMemo(() => {
    const lp = snapshot?.lastPrice;
    if (!lp || !isFinite(lp)) return aiAnnotationsRaw;
    const ok = (p: number) => Math.abs((p - lp) / lp) <= 0.08;
    return aiAnnotationsRaw.filter((a) => {
      if (a.kind === "zone") return ok(a.top) && ok(a.bottom);
      return ok(a.price);
    });
  }, [aiAnnotationsRaw, snapshot?.lastPrice]);
  const pickerRef = useRef<HTMLDivElement>(null);
  const levelsRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<DashboardChatHandle>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [lensId, setLensId] = useState<ScanLensId>("wyckoff");
  const [lensOpen, setLensOpen] = useState(false);
  const coachRef = useRef<HTMLDivElement>(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [broker, setBroker] = useState<{ email: string; server: string; accountType: "demo" | "live" } | null>(null);
  const [activeCoach, setActiveCoach] = useState<string>(() =>
    typeof window === "undefined" ? "The Analyst" : readActiveCoach(),
  );
  useEffect(() => { setLensId(readActiveLensId()); }, []);
  useEffect(() => {
    const sync = () => setActiveCoach(readActiveCoach());
    const onStorage = (e: StorageEvent) => { if (e.key === COACH_KEY) sync(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
    };
  }, []);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("trademind.tradelocker.creds.v1");
      if (raw) {
        const c = JSON.parse(raw) as { email?: string; server?: string; accountType?: "demo" | "live" };
        if (c.email && c.server) setBroker({ email: c.email, server: c.server, accountType: c.accountType ?? "demo" });
      }
    } catch { /* ignore */ }
  }, []);
  const activeLens = SCAN_LENSES.find((l) => l.id === lensId) ?? SCAN_LENSES[0];

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const openTradingFloor = () => {
    const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol.tv)}`;
    const width = Math.min(1100, Math.round(window.screen.availWidth * 0.6));
    const height = Math.round(window.screen.availHeight * 0.92);
    const left = Math.max(0, window.screen.availWidth - width);
    const features = `popup=yes,width=${width},height=${height},left=${left},top=0`;
    const w = window.open(url, "trademind_tv_floor", features);
    if (!w) { toast.error("Popup blocked - allow popups to open the trading floor."); return; }
    w.focus();
  };


  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(levels)); } catch { /* ignore */ }
  }, [levels]);

  useEffect(() => {
    try { localStorage.setItem(SESSIONS_STORAGE_KEY, sessionsOn ? "true" : "false"); } catch { /* ignore */ }
  }, [sessionsOn]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
      if (levelsRef.current && !levelsRef.current.contains(e.target as Node)) setLevelsOpen(false);
      if (lensRef.current && !lensRef.current.contains(e.target as Node)) setLensOpen(false);
      if (coachRef.current && !coachRef.current.contains(e.target as Node)) setCoachOpen(false);
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) setViewMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pickLens(id: ScanLensId) {
    setLensId(id);
    writeActiveLensId(id);
    setLensOpen(false);
    const lens = SCAN_LENSES.find((l) => l.id === id);
    toast.success(`Scan Lens: ${lens?.name ?? id}`);
  }

  // Note: intentionally do NOT reset scan result or coach state when the symbol changes.
  // The AI coach and analysis panel must persist exactly where the user left them.


  // Honor ?ask= deep links (from Analytics quick questions)
  const search = Route.useSearch();
  const navigate = useNavigate();
  const askedRef = useRef<string | null>(null);
  const intervalLabel = INTERVALS.find((i) => i.value === interval)?.label ?? interval;

  // Persist current instrument/timeframe so the standalone chat route also
  // knows what the trader is looking at even without a live chart panel.
  useEffect(() => {
    const enabledLevels = ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none";
    writeLastChart({ ticker: symbolLabel(symbol), intervalLabel, enabledLevels });
  }, [symbol, intervalLabel, levels]);

  const runPlan = useServerFn(runResearchPlan);
  const createChatThreadFn = useServerFn(createChatThread);

  const sendToChat = (prompt: string, opts?: { focusChat?: boolean; targetThreadId?: string | null }) => {
    setRightOpen(true);
    setChatPanelView("conversation");
    if (opts?.focusChat !== false) {
      setRightTab("chat");
      setMobileView("chat");
    }
    let attempts = 0;
    const trySend = () => {
      attempts += 1;
      if (chatRef.current) {
        chatRef.current.scan(prompt, opts?.targetThreadId);
        return;
      }
      if (attempts < 20) window.setTimeout(trySend, 100);
    };
    window.setTimeout(trySend, 0);
  };

  const sanitizeVisibleGrade = (grade: import("@/lib/chartAnnotations").ChartGrade | null) => {
    if (!grade) return grade;
    const last = snapshot?.lastPrice;
    const bias = grade.bias ?? "neutral";
    if (!last || !isFinite(last) || last <= 0 || typeof grade.entry !== "number" || typeof grade.stop !== "number") return grade;
    if (!isFinite(grade.entry) || !isFinite(grade.stop)) return grade;
    const riskBase = Math.max(Math.abs(grade.entry - grade.stop), last * 0.001);
    const tol = Math.max(last * 0.0001, riskBase * 0.05);
    let entry = grade.entry;
    let stop = grade.stop;
    let tp1 = grade.tp1;
    let tp2 = grade.tp2;
    if (bias === "long" && entry > last + tol) entry = last;
    if (bias === "short" && entry < last - tol) entry = last;
    const risk = Math.max(Math.abs(entry - stop), last * 0.001);
    if (bias === "long") {
      stop = entry - risk;
      tp1 = typeof tp1 === "number" && isFinite(tp1) ? Math.max(tp1, entry + risk * 1.5) : entry + risk * 1.5;
      tp2 = typeof tp2 === "number" && isFinite(tp2) ? Math.max(tp2, tp1 + risk * 1.5, entry + risk * 3) : entry + risk * 3;
    } else if (bias === "short") {
      stop = entry + risk;
      tp1 = typeof tp1 === "number" && isFinite(tp1) ? Math.min(tp1, entry - risk * 1.5) : entry - risk * 1.5;
      tp2 = typeof tp2 === "number" && isFinite(tp2) ? Math.min(tp2, tp1 - risk * 1.5, entry - risk * 3) : entry - risk * 3;
    }
    return { ...grade, entry, stop, tp1, tp2 };
  };

  useEffect(() => {
    const q = search.ask?.trim();
    if (!q || askedRef.current === q) return;
    askedRef.current = q;
    sendToChat(q);
    navigate({ to: "/dashboard", search: (prev: DashboardSearch) => ({ ...prev, ask: undefined }), replace: true });
  }, [search.ask, navigate]);

  // Honor ?symbol= deep links (e.g. from AI Signals tab)
  const symbolAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const t = search.symbol?.trim();
    if (!t || symbolAppliedRef.current === t) return;
    const match = SYMBOLS.find((s) => s.ticker.toLowerCase() === t.toLowerCase() || s.tv.toLowerCase() === t.toLowerCase());
    if (match) {
      setSymbol(match);
      symbolAppliedRef.current = t;
    }
    navigate({ to: "/dashboard", search: (prev: DashboardSearch) => ({ ...prev, symbol: undefined }), replace: true });
  }, [search.symbol, navigate]);

  const applyPlanToSignalCards = (plan: ScanResult) => {
    const num = (s: string): number | undefined => {
      if (!s || s === "-") return undefined;
      const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
      return isFinite(n) ? n : undefined;
    };
    const biasMap: Record<string, "long" | "short" | "neutral"> = {
      Long: "long", Short: "short", Neutral: "neutral",
    };
    const last = snapshot?.lastPrice;
    let entry = num(plan.entry);
    let stop = num(plan.stop);
    let tp1 = num(plan.tp1);
    let tp2 = num(plan.tp2);
    const bias = biasMap[plan.bias] ?? "neutral";
    if (entry && stop && tp1 && tp2 && last && isFinite(last) && last > 0) {
      const tol = Math.max(last * 0.0001, Math.abs(entry - stop) * 0.05);
      if (bias === "long" && entry > last + tol) entry = last;
      if (bias === "short" && entry < last - tol) entry = last;
      const risk = Math.max(Math.abs(entry - stop), last * 0.001);
      if (bias === "long") {
        stop = entry - risk;
        tp1 = Math.max(tp1, entry + risk * 1.5);
        tp2 = Math.max(tp2, tp1 + risk * 1.5, entry + risk * 3);
      } else if (bias === "short") {
        stop = entry + risk;
        tp1 = Math.min(tp1, entry - risk * 1.5);
        tp2 = Math.min(tp2, tp1 - risk * 1.5, entry - risk * 3);
      }
    }
    setAiGrade({
      grade: plan.grade,
      bias,
      confidence: typeof plan.confidence === "number" ? plan.confidence : undefined,
      entry,
      stop,
      tp1,
      tp2,
      strength: plan.notes,
      weakness: plan.details,
    });
    if (entry && stop && tp1 && tp2 && bias !== "neutral") {
      setAiAnnotationsRaw([
        { kind: "hline", price: entry, label: "Entry", color: bias === "long" ? "var(--bull)" : "#ef4444" },
        { kind: "hline", price: stop, label: "Stop", color: "#ef4444", dashed: true },
        { kind: "hline", price: tp1, label: "TP1", color: "var(--bull)", dashed: true },
        { kind: "hline", price: tp2, label: "TP2", color: "var(--bull)", dashed: true },
      ]);
    } else {
      setAiAnnotationsRaw([]);
    }
  };

  const scanResultToChatText = (plan: ScanResult, scanSymbol: Symbol) => {
    const num = (s: string): number | undefined => {
      if (!s || s === "-") return undefined;
      const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
      return isFinite(n) ? n : undefined;
    };
    const bias = plan.bias.toLowerCase() as "long" | "short" | "neutral";
    const last = snapshot?.lastPrice;
    let entry = num(plan.entry);
    let stop = num(plan.stop);
    let tp1 = num(plan.tp1);
    let tp2 = num(plan.tp2);
    if (entry && stop && tp1 && tp2 && last && isFinite(last) && last > 0) {
      const tol = Math.max(last * 0.0001, Math.abs(entry - stop) * 0.05);
      if (bias === "long" && entry > last + tol) entry = last;
      if (bias === "short" && entry < last - tol) entry = last;
      const risk = Math.max(Math.abs(entry - stop), last * 0.001);
      if (bias === "long") {
        stop = entry - risk;
        tp1 = Math.max(tp1, entry + risk * 1.5);
        tp2 = Math.max(tp2, tp1 + risk * 1.5, entry + risk * 3);
      } else if (bias === "short") {
        stop = entry + risk;
        tp1 = Math.min(tp1, entry - risk * 1.5);
        tp2 = Math.min(tp2, tp1 - risk * 1.5, entry - risk * 3);
      }
    }
    const dec = decimalsFor(last || entry || 1);
    const safeEntry = entry === undefined ? plan.entry : fmtPrice(entry, dec);
    const safeStop = stop === undefined ? plan.stop : fmtPrice(stop, dec);
    const safeTp1 = tp1 === undefined ? plan.tp1 : fmtPrice(tp1, dec);
    const safeTp2 = tp2 === undefined ? plan.tp2 : fmtPrice(tp2, dec);
    const gradePayload = {
      grade: plan.grade,
      bias,
      confidence: plan.confidence,
      entry,
      stop,
      tp1,
      tp2,
      strength: plan.notes,
      weakness: plan.details,
    };
    const levelLines = plan.grade === "NO ENTRY"
      ? ["No entry - stand down until the setup improves."]
      : [
          `Entry: ${safeEntry}`,
          `Stop: ${safeStop}`,
          `TP1: ${safeTp1}`,
          `TP2: ${safeTp2}`,
          `R:R: ${plan.rr}`,
        ];
    return [
      `${scanSymbol.name} scan: ${plan.grade} ${plan.bias}. Confidence ${plan.confidence}%.`,
      ...levelLines,
      `Strength: ${plan.notes}`,
      `Weakness: ${plan.details}`,
      "```chart-grade",
      JSON.stringify(gradePayload),
      "```",
    ].join("\n");
  };

  const startNewChat = async () => {
    setRightTab("chat");
    setChatPanelView("conversation");
    try {
      // Title new chats with the currently-viewed instrument so history entries
      // stay identifiable even before any scan or symbol is mentioned in-thread.
      const t = await createChatThreadFn({ data: { title: historyInstrumentTitle(symbol) } });
      if (t?.id) setActiveThreadId(t.id);
    } catch {
      setActiveThreadId(null);
      toast.error("Could not start a new chat");
    }
  };


  const runScan = async (from: "chat" | "analysis" = "analysis") => {
    setScanning(true);
    emitFirstWeekEvent("scan-run");

    setAiGrade(null);
    const enabledLevels = ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none";
    const lens = findLens(lensId);
    const displayText = `Scanning ${symbolLabel(symbol)} (${intervalLabel})…`;
    const modelPrompt = `Scan ${symbolLabel(symbol)} on ${intervalLabel}. Give me 2-3 short sentences of coaching context: what to watch for right now, what would confirm or invalidate, and any risk note. Refer to the instrument by its friendly name (e.g. "Gold"), not the raw ticker. Levels I'm watching: ${enabledLevels}. Do not produce your own grade card or numeric entry/stop/targets - the grade card comes separately.`;
    const prompt = `<<<SCAN_DISPLAY:${displayText}>>>\n${modelPrompt}`;
    assertScanPromptMatchesSymbol(modelPrompt, symbol, "runScan");
    setRightOpen(true);
    if (from === "chat") {
      setRightTab("chat");
      setChatPanelView("conversation");
      setMobileView("chat");
    } else {
      setRightTab("analysis");
      setChatPanelView("conversation");
      setMobileView("scan");
    }
    // Always start a fresh chat thread per scan so each scan gets its own
    // history entry tagged with the scanned instrument - matches behavior
    // when running a scan from within a new chat.
    let scanThreadId: string | null = null;
    try {
      const t = await createChatThreadFn({ data: { title: `${historyInstrumentTitle(symbol)} Scan` } });
      if (t?.id) {
        scanThreadId = t.id;
        setActiveThreadId(t.id);
      }
    } catch {
      // non-fatal - fall through with existing thread
    }
    // Always post the scan prompt to chat so the user sees activity immediately.
    sendToChat(prompt, { focusChat: from === "chat", targetThreadId: scanThreadId });

    runPlan({ data: { ticker: symbol.ticker, interval, lensDesc: `${lens.name}: ${lens.promptEmphasis}` } })
      .then((plan) => {
        const r = plan as ScanResult;
        setResult(r);
        applyPlanToSignalCards(r);
        // Single source of truth: the Analysis engine's grade card is always
        // appended to the chat thread so Chat and Analysis never disagree.
        const replyText = scanResultToChatText(r, symbol);
        chatRef.current?.appendScanReply(replyText, scanThreadId);
      })
      .catch(() => {
        setResult({
          grade: "NO ENTRY", bias: "Neutral", confidence: 0,
          notes: "Research service is temporarily unavailable. Please try again in a moment.",
          entry: "-", stop: "-", tp1: "-", tp2: "-", rr: "-",
          details: "The analysis engine couldn't be reached. Your chart and levels are unaffected.",
        });
      })
      .finally(() => {
        setScanning(false);
        setLastUpdatedAt(Date.now());
      });
  };








  const toggleLevel = (k: LevelKey) => setLevels((p) => ({ ...p, [k]: !p[k] }));
  const enabledCount = ALL_LEVELS.filter((k) => levels[k]).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Row 1: symbol + timeframes + right-side pickers */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-b border-border/60 bg-card/40">


        <div className="relative shrink-0" ref={pickerRef} data-tour="symbol-picker">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent/40 transition"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
            <span className="font-display text-base font-semibold tracking-tight uppercase">{symbol.ticker.replace("/", "").replace("XAUUSD", "GOLD")}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
          {pickerOpen && (
            <div role="listbox" className="absolute left-0 mt-2 w-[min(18rem,calc(100vw-2rem))] max-h-80 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-50">
              {SYMBOLS.map((s) => {
                const active = s.tv === symbol.tv;
                return (
                  <button
                    key={s.tv}
                    role="option"
                    aria-selected={active}
                    onClick={() => { setSymbol(s); setPickerOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-3 hover:bg-accent/40 transition ${
                      active ? "bg-primary/10 text-primary" : "text-foreground"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.ticker}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{s.name} · {s.venue}</div>
                    </div>
                    {active && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Timeframe pills */}
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
          {INTERVALS.map((i) => (
            <button
              key={i.value}
              onClick={() => setIntervalState(i.value)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                interval === i.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Right-side pickers: Wyckoff (lens), The Analyst (coach) */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">

          <div className="relative" ref={lensRef}>
            <button
              onClick={() => setLensOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs font-medium hover:border-primary/50 transition"
              title="Scan lens"
            >
              <Crosshair className="h-3.5 w-3.5 text-primary" />
              <span>{activeLens.name}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${lensOpen ? "rotate-180" : ""}`} />
            </button>
            {lensOpen && (
              <div role="listbox" className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-50">
                {SCAN_LENSES.map((l) => {
                  const isActive = l.id === lensId;
                  return (
                    <button
                      key={l.id}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => pickLens(l.id)}
                      className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/40 last:border-0 hover:bg-accent/40 transition ${
                        isActive ? "bg-primary/10 text-primary" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{l.name}</span>
                        {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{l.desc}</div>
                    </button>
                  );
                })}
                <Link to="/scan-lens" className="block px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/60">
                  Manage all lenses →
                </Link>
              </div>
            )}
          </div>

          {(() => {
            const meta = COACH_ICON_META[activeCoach] ?? DEFAULT_COACH_ICON;
            const Icon = meta.icon;
            const coachNames = Object.keys(COACH_ICON_META);
            return (
              <div className="relative" ref={coachRef}>
                <button
                  onClick={() => setCoachOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs font-medium hover:border-primary/50 transition"
                  title="Change active AI coach"
                >
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${meta.iconBg} ${meta.iconText} shrink-0`}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <span>{activeCoach}</span>
                  <ChevronDown className={`h-3 w-3 transition-transform ${coachOpen ? "rotate-180" : ""}`} />
                </button>
                {coachOpen && (
                  <div role="listbox" className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-50">
                    {coachNames.map((name) => {
                      const m = COACH_ICON_META[name] ?? DEFAULT_COACH_ICON;
                      const CIcon = m.icon;
                      const isActive = name === activeCoach;
                      return (
                        <button
                          key={name}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            writeActiveCoach(name);
                            setActiveCoach(name);
                            setCoachOpen(false);
                            if (name !== activeCoach) toast.success(`${name} is now your coach`);
                          }}
                          className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/40 last:border-0 hover:bg-accent/40 transition ${
                            isActive ? "bg-primary/10 text-primary" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${m.iconBg} ${m.iconText} shrink-0`}>
                                <CIcon className="h-3 w-3" />
                              </span>
                              <span className="font-medium truncate">{name}</span>
                            </div>
                            {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug pl-7">{m.tagline}</div>
                        </button>
                      );
                    })}
                    <Link to="/coaches" className="block px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/60">
                      Manage all coaches →
                    </Link>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Row 2: Live / Setup tabs + compact View menu + fullscreen */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1 border-b border-border/60 bg-card/30 text-xs">
        <button
          onClick={() => setChartTab("live")}
          className={`inline-flex items-center gap-1.5 py-1 border-b-2 transition ${
            chartTab === "live" ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="h-3.5 w-3.5" /> Live
        </button>
        <button
          onClick={() => setChartTab("setup")}
          className={`inline-flex items-center gap-1.5 py-1 border-b-2 transition ${
            chartTab === "setup" ? "border-primary text-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Crosshair className="h-3.5 w-3.5" /> Setup
        </button>

        <button
          type="button"
          onClick={toggleChartFullscreen}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
          title={isChartFullscreen ? "Exit full screen" : "Full screen chart"}
          aria-label={isChartFullscreen ? "Exit full screen" : "Full screen chart"}
        >
          {isChartFullscreen ? <Minimize className="h-3 w-3" /> : <Maximize className="h-3 w-3" />}
          <span className="hidden sm:inline">{isChartFullscreen ? "Exit" : "Expand"}</span>
        </button>

        <div className="flex-1" />

        {/* Single "View" popover holding candle style, sessions, and indicators */}
        <div className="relative" ref={viewMenuRef}>
          <button
            onClick={() => setViewMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
            title="Chart levels"
          >
            <Settings2 className="h-3 w-3" />
            <span>Levels</span>
            {chartTab === "setup" && enabledCount > 0 && (
              <span className="text-primary">· {enabledCount}</span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${viewMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {viewMenuOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-card shadow-xl z-50 p-3 space-y-3">
              <div className="text-[10px] text-muted-foreground italic border-b border-border/40 pb-2">
                Levels apply to Live where supported and fully on Setup.
              </div>

              {/* Candle style */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground/80">Candle</span>
                <div className="inline-flex items-center rounded-md border border-border bg-background/50 p-0.5">
                  <button
                    disabled={chartTab !== "setup"}
                    onClick={() => setCandleType("candle")}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition disabled:opacity-40 ${
                      candleType === "candle" && chartTab === "setup" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Candle
                  </button>
                  <button
                    disabled={chartTab !== "setup"}
                    onClick={() => setCandleType("ha")}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition disabled:opacity-40 ${
                      candleType === "ha" && chartTab === "setup" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    HA
                  </button>
                </div>
              </div>

              {/* Sessions */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground/80 inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Sessions
                </span>
                <button
                  disabled={chartTab !== "setup"}
                  onClick={() => setSessionsOn((v) => !v)}
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-40 ${
                    sessionsOn && chartTab === "setup"
                      ? "border-bull/40 bg-bull/10 text-bull"
                      : "border-border bg-background/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {sessionsOn ? "On" : "Off"}
                </button>
              </div>

              {/* Indicators */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-foreground/80">Indicators</span>
                  <span className="text-[10px] text-muted-foreground">{enabledCount} / {ALL_LEVELS.length}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ALL_LEVELS.map((k) => {
                    const on = levels[k];
                    const meta = LEVEL_META[k];
                    return (
                      <button
                        key={k}
                        onClick={() => toggleLevel(k)}
                        className={`rounded-md border px-1.5 py-1 text-[11px] font-medium transition ${
                          on ? meta.tone : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                        style={on ? { boxShadow: `inset 0 0 0 1px ${meta.color}40` } : undefined}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
                  <button
                    onClick={() => setLevels(Object.fromEntries(ALL_LEVELS.map((k) => [k, true])) as Record<LevelKey, boolean>)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    All on
                  </button>
                  <button
                    onClick={() => setLevels(Object.fromEntries(ALL_LEVELS.map((k) => [k, false])) as Record<LevelKey, boolean>)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    All off
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={scanning ? () => { chatRef.current?.stop(); voice.stop(); setScanning(false); } : () => runScan("analysis")}
          className={`hidden lg:inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
            scanning
              ? "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
          title={scanning ? "Stop scan" : "Run scan on this chart"}
        >
          {scanning ? <Square className="h-3 w-3" /> : <Crosshair className="h-3 w-3" />}
          <span>{scanning ? "Stop Scan" : "Run Scan"}</span>
        </button>


        <button
          onClick={() => setRightOpen((v) => !v)}
          className="hidden lg:inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-3 py-1 text-xs font-semibold text-foreground hover:border-primary/40 transition"
          title={rightOpen ? "Hide chat panel" : "Open chat panel"}
        >
          {rightOpen ? <PanelRightClose className="h-3 w-3" /> : <PanelRightOpen className="h-3 w-3" />}
          <span>{rightOpen ? "Hide Chat" : "Open Chat"}</span>
        </button>
      </div>



      {/* Mobile-only view switcher: Chart / Scan / Chat are mutually exclusive on small screens
          so the coach panel never squishes the chart and vice versa. */}
      <div className="lg:hidden shrink-0 flex items-center gap-1 px-3 py-1 border-b border-border/60 bg-card/40">
        {([
          { id: "chart", label: "Chart", Icon: LineChart },
          { id: "scan",  label: "Scan",  Icon: BarChart3 },
          { id: "chat",  label: "Chat",  Icon: MessageSquare },
        ] as const).map(({ id, label, Icon }) => {
          const active = mobileView === id;
          return (
            <button
              key={id}
              onClick={() => { setMobileView(id); if (id !== "chart") setRightTab(id === "scan" ? "analysis" : "chat"); }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition ${
                active ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          );
        })}
      </div>

      {/* Chart area */}
      <div ref={chartAreaRef} className={`flex-1 min-h-0 bg-card overflow-hidden ${mobileView === "chart" ? "flex" : "hidden"} lg:flex`} data-tour="chart">

        <div className="flex-1 min-w-0 flex flex-col">

          {/* Scan output preview - sits above the chart so it never overlaps candles */}
          {!isChartFullscreen && (
            <ChartSignalCards
              grade={aiGrade}
              lastPrice={snapshot?.lastPrice}
              symbol={symbol.ticker}
              scanning={scanning}
              onClear={aiGrade ? () => { setAiGrade(null); setAiAnnotationsRaw([]); } : undefined}
            />
          )}


          <div className="flex-1 min-h-0 overflow-hidden relative">
            {chartTab === "live" ? (
              <TradingViewChart symbol={symbol.tv} interval={interval} enabled={levels} sessions={sessionsOn} />
            ) : (
              <NativeChart symbol={symbol.tv} ticker={symbol.ticker} interval={interval} enabled={levels} sessions={sessionsOn} onSnapshot={setSnapshot} annotations={aiAnnotations} candleType={candleType} />
            )}

            {/* Exit-fullscreen floater (only visible in fullscreen, top-left so it never covers TradingView's camera button) */}
            {isChartFullscreen && (
              <button
                type="button"
                onClick={toggleChartFullscreen}
                className="absolute left-3 top-3 z-40 rounded-md border border-border bg-background/90 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground backdrop-blur inline-flex items-center gap-1"
                title="Exit full screen"
                aria-label="Exit full screen"
              >
                <Minimize className="h-3 w-3" /> Exit
              </button>
            )}

            {chartTab === "live" && aiAnnotations.length > 0 && (
              <div className="pointer-events-none absolute left-3 top-12 z-20 rounded-md border border-primary/40 bg-background/90 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-primary backdrop-blur">
                Entry markers available on Setup
              </div>
            )}
            {aiConcept && (
              <ChartConceptOverlay concept={aiConcept} onClose={() => setAiConcept(null)} />
            )}
            {aiAnnotations.length > 0 && (
              <button
                type="button"
                onClick={() => setAiAnnotationsRaw([])}
                className="absolute right-3 top-12 z-30 rounded-md border border-border bg-background/90 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground backdrop-blur"
              >
                Clear markers
              </button>
            )}
          </div>



          {/* Broker strip - thin, single line so it doesn't eat chart height */}
          {!isChartFullscreen && (
            <div className="shrink-0 border-t border-border/60 px-3 py-0.5 flex items-center justify-between gap-2 text-[11px]">


              {broker ? (
                <div className="flex items-center gap-2 min-w-0 text-muted-foreground">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-bull opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-bull" />
                  </span>
                  <span className="truncate">
                    <span className="text-foreground font-medium">Broker connected</span>
                    <span className="hidden sm:inline"> · {broker.email} · {broker.accountType}</span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                  <Plug className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Chart-only mode. <Link to="/settings" className="text-primary hover:underline">Connect broker</Link></span>
                </div>
              )}
              <button
                onClick={openTradingFloor}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 shrink-0"
                title="Open TradingView trading floor"
              >
                <Maximize2 className="h-3 w-3" /> Trade
              </button>
            </div>
          )}

        </div>

        {rightOpen && !isChartFullscreen && (
          <aside className={`hidden lg:flex shrink-0 border-l border-border bg-card flex-col ${
            panelWidth === "narrow" ? "w-[280px]" : panelWidth === "wide" ? "w-[560px]" : "w-[400px]"
          }`}>
            {/* Header: tabs row + width controls row */}
            <div className="border-b border-border/60">
              <div className="flex items-center gap-1 px-2 py-1.5">

                <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
                  <button
                    onClick={() => setRightTab("analysis")}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                      rightTab === "analysis" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> Analysis
                  </button>
                  <button
                    onClick={() => { setRightTab("chat"); setChatPanelView("conversation"); }}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                      rightTab === "chat" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Chat
                  </button>
                </div>
                {activeModel && (
                  <span
                    className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20"
                    title={`Powered by ${activeModel.label}`}
                  >
                    {activeModel.label}
                  </span>
                )}
                <button
                  onClick={() => setRightOpen(false)}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 shrink-0"
                  title="Close panel"
                  aria-label="Close panel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>


            <div className="flex-1 min-h-0 overflow-hidden relative">
            <div className={`absolute inset-0 overflow-y-auto ${rightTab === "analysis" ? "" : "hidden"}`}>
              <div className="p-5">
                <ScanBody
                  result={result}
                  scanning={scanning}
                  symbol={symbol}
                  intervalLabel={intervalLabel}
                  lensId={lensId}
                  runScan={() => runScan("analysis")}

                  onAttach={(file) => {
                    setRightTab("chat");
                    setChatPanelView("conversation");
                    const attachPrompt = `Scan this chart screenshot for ${symbolLabel(symbol)} on ${intervalLabel}. Refer to the instrument by its friendly name (e.g. "Gold"), not the raw ticker. Give me grade, bias, entry, stop, TP1, TP2, R:R, and a 1-2 sentence rationale.`;
                    // Defer so the chat panel mounts (chatRef becomes valid) before we attach.
                    setTimeout(() => { chatRef.current?.attach(file, attachPrompt); }, 0);
                    setScanning(true);
                    const lens = findLens(lensId);
                    runPlan({ data: { ticker: symbol.ticker, interval, lensDesc: `${lens.name}: ${lens.promptEmphasis}` } })
                      .then((plan) => { const r = plan as ScanResult; setResult(r); applyPlanToSignalCards(r); })
                      .catch(() => { /* coach chat still runs the vision analysis */ })
                      .finally(() => setScanning(false));
                  }}
                  onStopScan={() => { chatRef.current?.stop(); voice.stop(); setScanning(false); }}
                  onStopVoice={() => voice.stop()}
                  voiceSpeaking={voice.speaking}
                />
              </div>
            </div>
              <div className={`absolute inset-0 ${rightTab === "chat" ? "" : "hidden"}`}>
                <div className="flex h-full min-h-0 flex-col">
                  <div className="shrink-0 flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
                    <button
                      onClick={startNewChat}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:border-primary/50 transition"
                    >
                      New
                    </button>
                    <button
                      onClick={() => setChatPanelView("history")}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                        chatPanelView === "history" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" /> History
                    </button>
                  </div>
                  {chatPanelView === "conversation" ? (
                    <div className="flex-1 min-h-0">
                      <DashboardChatPanel
                        ref={isDesktop ? chatRef : null}
                        onRunScan={() => runScan("chat")}

                        onStopScan={() => { voice.stop(); setScanning(false); }}
                        scanning={scanning}
                        threadIdOverride={activeThreadId}
                        onAnnotations={(a) => { setAiAnnotationsRaw(a); if (a.length > 0) setChartTab("setup"); }}
                        onShowMe={() => setChartTab("setup")}
                        onGrade={(g) => setAiGrade(sanitizeVisibleGrade(g))}
                        onConcept={setAiConcept}
                        chart={{
                          ticker: symbolLabel(symbol),
                          intervalLabel,
                          enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
                          snapshot: snapshot ?? undefined,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <ChatHistoryList
                        activeThreadId={activeThreadId}
                        currentTitle={historyInstrumentTitle(symbol)}
                        onPick={(id, sym) => { const s = findSymbolFromTag(sym); if (s) setSymbol(s); setActiveThreadId(id); setChatPanelView("conversation"); }}
                        onNew={(id) => { setActiveThreadId(id); setChatPanelView("conversation"); }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* Panel width footer */}
            <div className="shrink-0 border-t border-border/60 px-3 py-1.5 flex items-center justify-between gap-2">

              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Width</span>
              <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background/40 p-0.5">
                {(["narrow", "default", "wide"] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => setPanelWidth(w)}
                    className={`rounded px-2.5 py-0.5 text-[10px] font-medium capitalize transition ${
                      panelWidth === w ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

      </div>

      {/* Mobile panel: Analysis / Chat. Only visible when the mobile view
          switcher is on Scan or Chat, and expands to fill the remaining height so it
          isn't squished under the chart. */}
      <div className={`lg:hidden ${mobileView === "chart" ? "hidden" : "flex-1 min-h-0 flex flex-col"} bg-card`} data-tour="scan">
        <div className="shrink-0 flex items-center gap-0.5 border-b border-border/60 px-2 py-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setRightTab("analysis")}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              rightTab === "analysis" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" /> Analysis
          </button>
          <button
            onClick={() => { setRightTab("chat"); setChatPanelView("conversation"); }}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              rightTab === "chat" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Chat
          </button>
        </div>
        {rightTab === "analysis" && (
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
            <ScanBody
              result={result}
              scanning={scanning}
              symbol={symbol}
              intervalLabel={intervalLabel}
              lensId={lensId}
              runScan={() => runScan("analysis")}
              onAttach={(file) => {
                setRightTab("chat");
                setChatPanelView("conversation");
                const attachPrompt = `Scan this chart screenshot for ${symbolLabel(symbol)} on ${intervalLabel}. Refer to the instrument by its friendly name (e.g. "Gold"), not the raw ticker. Give me grade, bias, entry, stop, TP1, TP2, R:R, and a 1-2 sentence rationale.`;
                assertScanPromptMatchesSymbol(attachPrompt, symbol, "attachScan");
                setTimeout(() => { chatRef.current?.attach(file, attachPrompt); }, 0);
                setScanning(true);
                const lens = findLens(lensId);
                runPlan({ data: { ticker: symbol.ticker, interval, lensDesc: `${lens.name}: ${lens.promptEmphasis}` } })
                  .then((plan) => { const r = plan as ScanResult; setResult(r); applyPlanToSignalCards(r); })
                  .catch(() => { /* coach chat still runs the vision analysis */ })
                  .finally(() => setScanning(false));
              }}
              onStopScan={() => { chatRef.current?.stop(); voice.stop(); setScanning(false); }}
              onStopVoice={() => voice.stop()}
              voiceSpeaking={voice.speaking}
            />
          </div>
        )}
        <div className={`flex-1 min-h-0 ${rightTab === "chat" ? "" : "hidden"}`}>
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
              <button
                onClick={startNewChat}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:border-primary/50 transition"
              >
                New
              </button>
              <button
                onClick={() => setChatPanelView("history")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  chatPanelView === "history" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <Clock className="h-3.5 w-3.5" /> History
              </button>
            </div>
            {chatPanelView === "conversation" ? (
              <div className="flex-1 min-h-0">
                <DashboardChatPanel
                  ref={!isDesktop ? chatRef : null}
                  onRunScan={() => runScan("chat")}
                  onStopScan={() => { voice.stop(); setScanning(false); }}
                  scanning={scanning}
                  threadIdOverride={activeThreadId}
                  onAnnotations={(a) => { setAiAnnotationsRaw(a); if (a.length > 0) setChartTab("setup"); }}
                        onShowMe={() => setChartTab("setup")}
                  onGrade={(g) => setAiGrade(sanitizeVisibleGrade(g))}
                  onConcept={setAiConcept}
                  chart={{
                    ticker: symbolLabel(symbol),
                    intervalLabel,
                    enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
                    snapshot: snapshot ?? undefined,
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ChatHistoryList
                  activeThreadId={activeThreadId}
                  currentTitle={historyInstrumentTitle(symbol)}
                  onPick={(id, sym) => { const s = findSymbolFromTag(sym); if (s) setSymbol(s); setActiveThreadId(id); setChatPanelView("conversation"); }}
                  onNew={(id) => { setActiveThreadId(id); setChatPanelView("conversation"); }}
                />
              </div>
            )}
          </div>
        </div>
      </div>



    </div>
  );
}

function ScanBody({
  result, scanning, symbol, intervalLabel, lensId, runScan, onAttach, onStopScan, onStopVoice, voiceSpeaking,
}: {
  result: ScanResult | null;
  scanning: boolean;
  symbol: Symbol;
  intervalLabel: string;
  lensId: ScanLensId;
  runScan: () => void;
  onAttach: (file: File) => void;
  onStopScan: () => void;
  onStopVoice: () => void;
  voiceSpeaking: boolean;
}) {
  if (!result && !scanning) {
    return (
      <div className="flex flex-col items-center text-center gap-3">
        <Crosshair className="h-6 w-6 text-primary" />
        <div className="font-semibold">Ready to scan</div>
        <p className="text-sm text-muted-foreground max-w-sm">
          Grade the current setup on {symbol.ticker}, or attach a chart screenshot to scan that instead.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
          <button
            onClick={runScan}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
          >
            Run scan
          </button>
          <ScreenshotAttach onPick={onAttach} />
        </div>
      </div>
    );
  }
  if (scanning) {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-2">
        <Loader2 className="h-6 w-6 text-primary animate-spin" />
        <div className="font-semibold">Scanning {symbol.ticker}…</div>
        <p className="text-sm text-muted-foreground">Reading structure, sweeps, BOS, retests.</p>
        <button
          onClick={onStopScan}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/15 transition"
        >
          <Square className="h-3 w-3" /> Stop scan
        </button>
      </div>
    );
  }
  return (
    <ScanTicket
      result={result!}
      symbol={symbol}
      lensId={lensId}
      onRescan={runScan}
      onAttach={onAttach}
      onStopVoice={onStopVoice}
      voiceSpeaking={voiceSpeaking}
    />
  );
}

function FloatingCoach({
  open, onOpen, onClose, chatRef, chart, onRunScan, onStopScan, scanning,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  chatRef: React.RefObject<DashboardChatHandle | null>;
  chart: { ticker: string; intervalLabel: string; enabledLevels: string; snapshot?: ChartSnapshot };
  onRunScan?: () => void;
  onStopScan?: () => void;
  scanning?: boolean;
}) {
  const [minimized, setMinimized] = useState(false);
  const expanded = open && !minimized;
  const collapsed = open && minimized;

  return (
    <>
      {/* Bubble - hidden when panel is open */}
      {!open && (
        <button
          onClick={() => { setMinimized(false); onOpen(); }}
          aria-label="Open chat"
          data-tour="coach-bubble"
          className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 ring-1 ring-primary/40 hover:scale-105 active:scale-95 transition flex items-center justify-center"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {/* Minimized pill */}
      {collapsed && (
        <button
          onClick={() => setMinimized(false)}
          aria-label="Expand chat"
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-xl hover:bg-card transition"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
          </span>
          <span className="text-xs font-medium">Chat</span>
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

      {/* Mobile backdrop - tap to minimize */}
      {expanded && (
        <button
          aria-label="Hide coach"
          onClick={() => setMinimized(true)}
          className="sm:hidden fixed inset-0 z-30 bg-background/60 backdrop-blur-sm"
        />
      )}

      {/* Expanded panel - full-screen sheet on mobile, anchored card on desktop. Always mounted so chat state survives. */}
      <div
        className={`fixed z-40 left-0 right-0 bottom-0 top-0 h-[100dvh] sm:h-[min(640px,calc(100vh-3rem))] sm:top-auto sm:left-auto sm:right-6 sm:bottom-6 sm:w-[min(420px,calc(100vw-3rem))] transition-transform duration-200 ease-out ${
          expanded
            ? "translate-y-0 pointer-events-auto"
            : "translate-y-full sm:translate-y-4 pointer-events-none sm:opacity-0"
        }`}
      >
        <DashboardChatPanel ref={chatRef} chart={chart} onClose={() => { setMinimized(false); onClose(); }} onMinimize={() => setMinimized(true)} onRunScan={onRunScan} onStopScan={onStopScan} scanning={scanning} />
      </div>
    </>
  );
}

function ChatHistoryList({
  activeThreadId,
  currentTitle,
  onPick,
  onNew,
}: {
  activeThreadId: string | null;
  currentTitle: string;
  onPick: (id: string, symbol?: string | null) => void;
  onNew: (id: string | null) => void;
}) {
  const listFn = useServerFn(listChatThreads);
  const createFn = useServerFn(createChatThread);
  const delFn = useServerFn(deleteChatThread);
  type ThreadRow = { id: string; title: string; updated_at: string; preview?: string; symbol?: string | null };
  const [threads, setThreads] = useState<Array<ThreadRow>>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    listFn()
      .then((rows: unknown) => setThreads(rows as Array<ThreadRow>))
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleNew = async () => {
    try {
      const t = await createFn({ data: { title: currentTitle } });
      if (t) {
        setThreads((prev) => [{ id: t.id, title: t.title, updated_at: t.updated_at, preview: currentTitle }, ...prev]);
        onNew(t.id);
      }
    } catch { toast.error("Could not start a new conversation"); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this TradeMind conversation?")) return;
    try {
      await delFn({ data: { threadId: id } });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeThreadId === id) onNew(null);
    } catch { toast.error("Could not delete conversation"); }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Chat history</div>
        <button
          onClick={handleNew}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:border-primary/50 transition"
        >
          + New
        </button>
      </div>
      {loading && <div className="text-xs text-muted-foreground italic px-1 py-2">Loading…</div>}
      {!loading && threads.length === 0 && (
        <div className="text-xs text-muted-foreground italic px-1 py-2">No conversations yet.</div>
      )}
      <div className="space-y-1">
        {threads.map((t) => {
          const active = activeThreadId === t.id;
          const when = (() => {
            try {
              const d = new Date(t.updated_at);
              const now = new Date();
              const sameDay = d.toDateString() === now.toDateString();
              return sameDay
                ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
            } catch { return ""; }
          })();
          return (
            <div
              key={t.id}
              onClick={() => onPick(t.id, t.symbol ?? null)}
              className={`group flex items-start gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition ${
                active ? "bg-primary/15 text-primary" : "hover:bg-accent/40 text-foreground/85"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-foreground/90">{t.preview || t.title}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{when}</span>
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(t.id, e)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
                aria-label="Delete conversation"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

