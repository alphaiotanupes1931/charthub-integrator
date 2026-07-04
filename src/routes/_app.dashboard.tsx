import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { NativeChart, LEVEL_META, type LevelKey, type ChartSnapshot } from "@/components/NativeChart";
import { ChevronDown, Crosshair, Loader2, Check, Activity, LayoutGrid, Clock, MessageSquare, X, Plug, Maximize2, Square, Paperclip, ChevronUp, PanelRightClose, PanelRightOpen, BarChart3, ThumbsUp, ThumbsDown, Brain, LineChart, Settings2, Maximize, Minimize } from "lucide-react";

import { useCoachVoice } from "@/hooks/useCoachVoice";
import { DashboardChatPanel, type DashboardChatHandle } from "@/components/DashboardChatPanel";
import { ChartConceptOverlay } from "@/components/ConceptDiagram";
import { ChartSignalCards } from "@/components/ChartSignalCards";
import { TodaysRecommendation } from "@/components/TodaysRecommendation";
import { SCAN_LENSES, readActiveLensId, writeActiveLensId, findLens, type ScanLensId } from "@/lib/scanLens";
import { readActiveCoach, writeActiveCoach, COACH_KEY } from "@/lib/chat-client";
import { voiceForCoach } from "@/lib/coachVoices";
import { COACH_ICON_META, DEFAULT_COACH_ICON } from "@/lib/coachMeta";
import { runResearchPlan } from "@/lib/agents/research.functions";
import { recordHermesFeedback } from "@/lib/agents/hermes.functions";
import { listChatThreads, createChatThread, deleteChatThread } from "@/lib/chat.functions";
import type { ResearchMemo } from "@/lib/agents/types";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";


type DashboardSearch = { ask?: string };

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard, TradeMind" },
      { name: "description", content: "Live chart and AI setup analysis for your active instrument." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): DashboardSearch => ({
    ask: typeof s.ask === "string" ? s.ask : undefined,
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
  // Build plan numbers — anchored to lastPrice when we have it; otherwise illustrative.
  const px = typeof lastPrice === "number" && isFinite(lastPrice) ? lastPrice : 100;
  const dec = decimalsFor(px);
  const stopPct = 0.004 + ((h >> 12) % 7) / 1000; // 0.4% – 1.1%
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
    details: `Trigger: ${bias === "Neutral" ? "wait for a sweep + BOS in either direction" : `${bias.toLowerCase()} on a 5m close back through the retest`}. Invalidation: ${bias === "Long" ? "close below" : bias === "Short" ? "close above" : "structural break of"} ${fmtPrice(stop, dec)}. Manage to break-even at TP1 (${fmtPrice(tp1, dec)}), trail the runner toward TP2 (${fmtPrice(tp2, dec)}). Risk fixed at 0.5–1R of account.`,
  };
}

const gradeColor: Record<ScanResult["grade"], string> = {
  "A+": "text-primary",
  A:   "text-emerald-400",
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
  result, symbol, lensId, onRescan, onAttach, onStopVoice, voiceSpeaking,
}: {
  result: ScanResult;
  symbol: Symbol;
  lensId: ScanLensId;
  onRescan: () => void;
  onAttach: (file: File) => void;
  onStopVoice: () => void;
  voiceSpeaking: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const isNoEntry = result.grade === "NO ENTRY";
  const lens = findLens(lensId);
  const sendFeedback = useServerFn(recordHermesFeedback);
  const [fbState, setFbState] = useState<null | 1 | -1>(null);
  const [fbNote, setFbNote] = useState("");
  const [fbNoteOpen, setFbNoteOpen] = useState(false);
  const submitFeedback = (rating: 1 | -1, note?: string) => {
    setFbState(rating);
    sendFeedback({ data: {
      kind: "scan",
      ticker: symbol.ticker,
      lens: lens.name,
      rating,
      note: note ?? null,
      context: { bias: result.bias, grade: result.grade, confidence: result.confidence, entry: result.entry, stop: result.stop, tp1: result.tp1, tp2: result.tp2 },
    } })
      .then(() => toast.success("Hermes learned from that."))
      .catch(() => toast.error("Couldn't save feedback."));
  };
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2">
            {symbol.ticker} · {result.bias}
          </div>
          <div className={`font-display text-6xl leading-none tracking-tight ${gradeColor[result.grade]}`}>
            {result.grade}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
            title="Run a new scan on the current chart"
          >
            <Crosshair className="h-3 w-3" /> New scan
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <Crosshair className="h-3 w-3 text-primary shrink-0" />
          <span className="text-muted-foreground truncate">Lens · <span className="text-foreground font-medium">{lens.name}</span></span>
        </div>
        <button
          onClick={() => setLensOpen((o) => !o)}
          className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
        >
          {lensOpen ? "Hide" : "What's this?"}
        </button>
      </div>
      {lensOpen && (
        <div className="text-xs text-muted-foreground leading-relaxed">
          <p className="mb-1">{lens.desc}</p>
          <p className="italic">{lens.promptEmphasis}</p>
        </div>
      )}

      <p className="text-sm leading-relaxed text-foreground/90">{result.notes}</p>

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

      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background/60 px-3 py-2 text-xs font-medium hover:border-primary/40 transition"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {open ? "Hide details" : "Show details"}
      </button>
      {open && (
        <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed text-foreground/90 space-y-3">
          <div>{result.details}</div>
          {result.memo && result.memo.notes.length > 0 && (
            <div className="border-t border-border/50 pt-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Research memo · consensus {result.memo.consensus} @ {result.memo.consensusConfidence}%
              </div>
              {result.memo.notes.map((n) => (
                <div key={n.role} className="rounded-md border border-border/50 bg-card/50 px-2.5 py-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] uppercase tracking-wider text-primary">{n.role}</span>
                    <span className="text-[10px] text-muted-foreground">{n.bias} · {n.confidence}%</span>
                  </div>
                  <div className="text-xs text-foreground/85 leading-snug">{n.summary}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Brain className="h-3.5 w-3.5 text-primary" />
            <span>Was this useful? Hermes will remember.</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => submitFeedback(1)}
              className={`h-7 w-7 inline-flex items-center justify-center rounded-md border transition ${fbState === 1 ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
              aria-label="Helpful"
              title="Helpful"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setFbNoteOpen(true); }}
              className={`h-7 w-7 inline-flex items-center justify-center rounded-md border transition ${fbState === -1 ? "border-destructive/60 bg-destructive/15 text-destructive" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"}`}
              aria-label="Not helpful"
              title="Not helpful"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {fbNoteOpen && fbState !== -1 && (
          <div className="flex items-center gap-2">
            <input
              value={fbNote}
              onChange={(e) => setFbNote(e.target.value)}
              placeholder="What was off? (optional)"
              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:border-primary/50"
            />
            <button
              onClick={() => { submitFeedback(-1, fbNote.trim() || undefined); setFbNoteOpen(false); }}
              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Send
            </button>
          </div>
        )}
      </div>

      <div className="pt-1 flex justify-center">
        <ScreenshotAttach onPick={onAttach} />
      </div>
    </div>
  );
}

function TicketCell({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

const ALL_LEVELS: LevelKey[] = ["VWAP","POC","SR","ZONES","FVG","FIB","LIQ","OF","CISD"];

const STORAGE_KEY = "trademind.levels.enabled.v2";
const SESSIONS_STORAGE_KEY = "trademind.sessions.enabled.v1";

const DEFAULT_LEVELS: Record<LevelKey, boolean> = { VWAP: true, POC: true, SR: true, ZONES: true, FVG: true, FIB: false, LIQ: true, OF: true, CISD: true };

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
  const [result, setResult] = useState<ScanResult | null>(null);
  const [levelsOpen, setLevelsOpen] = useState(false);

  
  const [levels, setLevels] = useState<Record<LevelKey, boolean>>(() =>
    typeof window !== "undefined" ? loadLevels() : { ...DEFAULT_LEVELS },
  );
  const [sessionsOn, setSessionsOn] = useState(() =>
    typeof window !== "undefined" ? loadSessionsOn() : false,
  );
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [lastUpdatedText, setLastUpdatedText] = useState<string>("");

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

  const [rightTab, setRightTab] = useState<"analysis" | "chat" | "history">("analysis");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState<"narrow" | "default" | "wide">("narrow");

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
  const [lensId, setLensId] = useState<ScanLensId>("wyckoff");
  const [lensOpen, setLensOpen] = useState(false);
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

  const runPlan = useServerFn(runResearchPlan);

  const sendToChat = (prompt: string, opts?: { focusChat?: boolean }) => {
    setRightOpen(true);
    if (opts?.focusChat !== false) {
      setRightTab("chat");
      setMobileView("chat");
    }
    let attempts = 0;
    const trySend = () => {
      attempts += 1;
      if (chatRef.current) {
        chatRef.current.scan(prompt);
        return;
      }
      if (attempts < 20) window.setTimeout(trySend, 100);
    };
    window.setTimeout(trySend, 0);
  };

  useEffect(() => {
    const q = search.ask?.trim();
    if (!q || askedRef.current === q) return;
    askedRef.current = q;
    sendToChat(q);
    navigate({ to: "/dashboard", search: {}, replace: true });
  }, [search.ask, navigate]);

  const applyPlanToSignalCards = (plan: ScanResult) => {
    const num = (s: string): number | undefined => {
      if (!s || s === "—") return undefined;
      const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
      return isFinite(n) ? n : undefined;
    };
    const biasMap: Record<string, "long" | "short" | "neutral"> = {
      Long: "long", Short: "short", Neutral: "neutral",
    };
    setAiGrade({
      grade: plan.grade,
      bias: biasMap[plan.bias] ?? "neutral",
      confidence: typeof plan.confidence === "number" ? plan.confidence : undefined,
      entry: num(plan.entry),
      stop: num(plan.stop),
      tp1: num(plan.tp1),
      tp2: num(plan.tp2),
      strength: plan.notes,
      weakness: plan.details,
    });
  };

  const runScan = () => {
    setScanning(true);
    setResult(null);
    setAiGrade(null);
    const enabledLevels = ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none";
    const lens = findLens(lensId);
    const prompt = `Scan ${symbolLabel(symbol)} on the ${intervalLabel} chart. Keep it brief (3-6 short lines total). Give me: Grade, Bias, Entry, Stop, TP1, TP2. Then two bullets: "Strength:" (one line, the strongest thing about this setup) and "Weakness:" (one line, what could kill it). No preamble, no long paragraphs. Refer to the instrument by its friendly name (e.g. "Gold"), not the raw ticker. Levels I'm watching: ${enabledLevels}.`;
    assertScanPromptMatchesSymbol(prompt, symbol, "runScan");
    // Open the AI analysis panel; send scan to chat thread in background
    // without stealing focus from the analysis view.
    setRightOpen(true);
    setRightTab("analysis");
    setMobileView("scan");
    sendToChat(prompt, { focusChat: false });
    runPlan({ data: { ticker: symbol.ticker, interval, lensDesc: `${lens.name}: ${lens.promptEmphasis}` } })
      .then((plan) => {
        const r = plan as ScanResult;
        setResult(r);
        applyPlanToSignalCards(r);
      })
      .catch(() => {
        setResult({
          grade: "NO ENTRY", bias: "Neutral", confidence: 0,
          notes: "Research service is temporarily unavailable. Please try again in a moment.",
          entry: "—", stop: "—", tp1: "—", tp2: "—", rr: "—",
          details: "The analysis engine couldn't be reached. Your chart and levels are unaffected.",
        });
      })
      .finally(() => setScanning(false));
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
              <div
                className="relative inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs font-medium hover:border-primary/50 transition"
                title="Change active AI coach"
              >
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md ${meta.iconBg} ${meta.iconText} shrink-0`}>
                  <Icon className="h-3 w-3" />
                </span>
                <span className="pr-4">{activeCoach}</span>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <select
                  value={activeCoach}
                  onChange={(e) => {
                    const name = e.target.value;
                    if (name === activeCoach) return;
                    writeActiveCoach(name);
                    setActiveCoach(name);
                    toast.success(`${name} is now your coach`);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  aria-label="Change active AI coach"
                >
                  {coachNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
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
            title="Chart view options"
          >
            <Settings2 className="h-3 w-3" />
            <span>View</span>
            {chartTab === "setup" && enabledCount > 0 && (
              <span className="text-primary">· {enabledCount}</span>
            )}
            <ChevronDown className={`h-3 w-3 transition-transform ${viewMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {viewMenuOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-card shadow-xl z-50 p-3 space-y-3">
              {chartTab !== "setup" && (
                <div className="text-[10px] text-muted-foreground italic border-b border-border/40 pb-2">
                  Switch to Setup for candle style, sessions, and indicators.
                </div>
              )}

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
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
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
                <div className={`grid grid-cols-3 gap-1.5 ${chartTab !== "setup" ? "opacity-40 pointer-events-none" : ""}`}>
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
                <div className={`mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[10px] ${chartTab !== "setup" ? "opacity-40 pointer-events-none" : ""}`}>
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
          onClick={scanning ? () => { chatRef.current?.stop(); voice.stop(); setScanning(false); } : runScan}
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

          {/* Scan output preview — sits above the chart so it never overlaps candles */}
          {!isChartFullscreen && (
            <ChartSignalCards
              grade={aiGrade}
              lastPrice={snapshot?.lastPrice}
              scanning={scanning}
              onClear={aiGrade ? () => { setAiGrade(null); setAiAnnotationsRaw([]); } : undefined}
            />
          )}


          <div className="flex-1 min-h-0 overflow-hidden relative">
            {chartTab === "live" && aiAnnotations.length === 0 ? (
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
                Native · Chat annotations
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



          {/* Broker strip — thin, single line so it doesn't eat chart height */}
          {!isChartFullscreen && (
            <div className="shrink-0 border-t border-border/60 px-3 py-0.5 flex items-center justify-between gap-2 text-[11px]">


              {broker ? (
                <div className="flex items-center gap-2 min-w-0 text-muted-foreground">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
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
                    onClick={() => setRightTab("chat")}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                      rightTab === "chat" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> Chat
                  </button>
                  <button
                    onClick={() => setRightTab("history")}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                      rightTab === "history" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" /> History
                  </button>
                </div>
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
                    runScan={runScan}
                    onAttach={() => { /* handled in chat tab */ }}
                    onStopScan={() => { chatRef.current?.stop(); voice.stop(); setScanning(false); }}
                    onStopVoice={() => voice.stop()}
                    voiceSpeaking={voice.speaking}
                  />
                </div>
              </div>
              <div className={`absolute inset-0 ${rightTab === "chat" ? "" : "hidden"}`}>
                <DashboardChatPanel
                  ref={chatRef}
                  onRunScan={runScan}
                  onStopScan={() => { voice.stop(); setScanning(false); }}
                  scanning={scanning}
                  threadIdOverride={activeThreadId}
                  onAnnotations={setAiAnnotationsRaw}
                  onGrade={setAiGrade}
                  onConcept={setAiConcept}
                  chart={{
                    ticker: symbolLabel(symbol),
                    intervalLabel,
                    enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
                    snapshot: snapshot ?? undefined,
                  }}
                />
              </div>
              <div className={`absolute inset-0 overflow-y-auto ${rightTab === "history" ? "" : "hidden"}`}>
                <ChatHistoryList
                  activeThreadId={activeThreadId}
                  onPick={(id) => { setActiveThreadId(id); setRightTab("chat"); }}
                  onNew={() => { setActiveThreadId(null); setRightTab("chat"); }}
                />
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

      {/* Mobile panel: Analysis / Chat / History. Only visible when the mobile view
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
            onClick={() => setRightTab("chat")}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              rightTab === "chat" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Chat
          </button>
          <button
            onClick={() => setRightTab("history")}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              rightTab === "history" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <Clock className="h-3.5 w-3.5" /> History
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
              runScan={runScan}
              onAttach={(file) => {
                setRightTab("chat");
                const attachPrompt = `Scan this chart screenshot for ${symbolLabel(symbol)} on ${intervalLabel}. Refer to the instrument by its friendly name (e.g. "Gold"), not the raw ticker. Give me grade, bias, entry, stop, TP1, TP2, R:R, and a 1-2 sentence rationale.`;
                assertScanPromptMatchesSymbol(attachPrompt, symbol, "attachScan");
                chatRef.current?.attach(file, attachPrompt);
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
        {rightTab === "chat" && (
          <div className="flex-1 min-h-0">
            <DashboardChatPanel
              ref={chatRef}
              onRunScan={runScan}
              onStopScan={() => { voice.stop(); setScanning(false); }}
              scanning={scanning}
              threadIdOverride={activeThreadId}
              onAnnotations={setAiAnnotationsRaw}
              onGrade={setAiGrade}
              onConcept={setAiConcept}
              chart={{
                ticker: symbolLabel(symbol),
                intervalLabel,
                enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
                snapshot: snapshot ?? undefined,
              }}
            />
          </div>
        )}
        {rightTab === "history" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ChatHistoryList
              activeThreadId={activeThreadId}
              onPick={(id) => { setActiveThreadId(id); setRightTab("chat"); }}
              onNew={() => { setActiveThreadId(null); setRightTab("chat"); }}
            />
          </div>
        )}
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
  onPick,
  onNew,
}: {
  activeThreadId: string | null;
  onPick: (id: string) => void;
  onNew: (id: string | null) => void;
}) {
  const listFn = useServerFn(listChatThreads);
  const createFn = useServerFn(createChatThread);
  const delFn = useServerFn(deleteChatThread);
  const [threads, setThreads] = useState<Array<{ id: string; title: string; updated_at: string }>>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    listFn()
      .then((rows: unknown) => setThreads(rows as Array<{ id: string; title: string; updated_at: string }>))
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleNew = async () => {
    try {
      const t = await createFn({ data: {} });
      if (t) {
        setThreads((prev) => [{ id: t.id, title: t.title, updated_at: t.updated_at }, ...prev]);
        onNew(t.id);
      }
    } catch { toast.error("Could not start a new conversation"); }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation?")) return;
    try {
      await delFn({ data: { threadId: id } });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeThreadId === id) onNew(null);
    } catch { toast.error("Could not delete"); }
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
          return (
            <div
              key={t.id}
              onClick={() => onPick(t.id)}
              className={`group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition ${
                active ? "bg-primary/15 text-primary" : "hover:bg-accent/40 text-foreground/85"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="flex-1 min-w-0 truncate">{t.title}</span>
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

