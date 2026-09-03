import { PageInstructions } from "@/components/PageInstructions";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { NativeChart, LEVEL_META, type LevelKey, type ChartSnapshot } from "@/components/NativeChart";
import { CANDLE_STYLES, CANDLE_STYLE_MAP, type CandleStyleId } from "@/lib/candleStyles";
import { enforceGradeDirection } from "@/lib/chartAnnotations";

import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";
import { ChevronDown, Crosshair, Loader2, Check, Activity, LayoutGrid, Clock, MessageSquare, X, Plug, Square, Paperclip, ChevronUp, PanelRightClose, PanelRightOpen, BarChart3, ThumbsUp, ThumbsDown, Brain, LineChart, Settings2, Maximize, Minimize, Maximize2, Minimize2, BookOpen, FlaskConical, Zap } from "lucide-react";


import { useCoachVoice } from "@/hooks/useCoachVoice";
import { DashboardChatPanel, type DashboardChatHandle } from "@/components/DashboardChatPanel";
import { ChartConceptOverlay } from "@/components/ConceptDiagram";
import { ChartSignalCards } from "@/components/ChartSignalCards";
import { ScanStamp } from "@/components/ScanStamp";
import { ScanVersionHistory } from "@/components/ScanVersionHistory";
import { ChartTradeBar } from "@/components/ChartTradeBar";
import { useTimezone, TIMEZONE_OPTIONS } from "@/hooks/useTimezone";
import { computeTiming, clockLabel, tzAbbrev } from "@/lib/tradeTiming";

import { TodaysRecommendation } from "@/components/TodaysRecommendation";
import { findStrategyByName, allStrategies } from "@/lib/customStrategies";
import { StrategyPresetCard } from "@/components/StrategyPresetCard";
import { readActiveStrategy, writeActiveStrategy } from "@/lib/chat-client";
import { SCAN_LENSES, readActiveLensId, writeActiveLensId, findLens, type ScanLensId } from "@/lib/scanLens";
import { ActionLoader } from "@/components/ActionLoader";
import { clearLastThreadId, readActiveCoach, writeActiveCoach, COACH_KEY, writeLastChart, readLastThreadId, writeLastThreadId } from "@/lib/chat-client";
import { voiceForCoach } from "@/lib/coachVoices";
import { COACH_ICON_META, DEFAULT_COACH_ICON } from "@/lib/coachMeta";
import { reportSystemNotice } from "@/lib/notifications.functions";
import { runResearchPlan } from "@/lib/agents/research.functions";
import { recordHermesFeedback } from "@/lib/agents/hermes.functions";
import { listChatThreads, createChatThread, deleteChatThread } from "@/lib/chat.functions";
import type { ResearchMemo, OrderFlow } from "@/lib/agents/types";
import { Link } from "@tanstack/react-router";
import { useTradeLogged } from "@/hooks/useTradeLogged";
import { PassTradeButton } from "@/components/PassTradeButton";
import { recordSignal, takeTrade } from "@/lib/signalHistory";
import { formatJournalPerf } from "@/lib/journalStats";
import { toast } from "sonner";
import { AutoBacktestVerify } from "@/components/AutoBacktestVerify";
import { useEntitlements } from "@/hooks/useEntitlements";
import { QuotaBadge } from "@/components/QuotaBadge";
import { UpgradeModal } from "@/components/UpgradeModal";

// Scan context: the active strategy playbook is fed to the planner so the
// Analysis grade is scored against the same rules the chat coach uses.
function activeStrategyDesc(): string | undefined {
  const name = readActiveStrategy();
  if (!name) return undefined;
  const s = findStrategyByName(name);
  if (!s) return name;
  const bits = [
    s.name,
    "style" in s && s.style ? `style ${s.style}` : "",
    "level" in s && s.level ? `level ${s.level}` : "",
    "rr" in s && s.rr != null ? `baseline R:R ${s.rr}` : "",
    "winRate" in s && s.winRate != null ? `baseline win rate ${s.winRate}%` : "",
    "rules" in s && s.rules ? `rules: ${s.rules}` : "",
    s.description ?? "",
  ].filter(Boolean);
  return bits.join(" | ").slice(0, 800);
}




type DashboardSearch = { ask?: string; symbol?: string; thread?: string; scan?: string };

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
    thread: typeof s.thread === "string" ? s.thread : undefined,
    scan: typeof s.scan === "string" ? s.scan : undefined,
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
  { tv: "OANDA:NAS100USD",   ticker: "NAS100",  name: "US Nasdaq 100",    venue: "OANDA"     },
  { tv: "OANDA:US30USD",     ticker: "US30",    name: "Dow Jones",        venue: "OANDA"     },
  { tv: "OANDA:SPX500USD",   ticker: "SPX500",  name: "S&P 500",          venue: "OANDA"     },
  { tv: "OANDA:WTICOUSD",    ticker: "WTI Oil", name: "US Crude Oil",     venue: "OANDA"     },
  { tv: "OANDA:EURUSD",      ticker: "EUR/USD", name: "Euro / Dollar",    venue: "OANDA"     },
  { tv: "OANDA:GBPUSD",      ticker: "GBP/USD", name: "Pound / Dollar",   venue: "OANDA"     },
  { tv: "OANDA:USDJPY",      ticker: "USD/JPY", name: "Dollar / Yen",     venue: "OANDA"     },
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
  dataSource?: string;
  dataFetchedAt?: string;
  candleCount?: number;
  refPrice?: number;
  counterTrend?: boolean;
  htfBias?: "bullish" | "bearish" | "neutral";

};

function fmtPrice(n: number, decimals: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Compact volume figures: 1.2M, 340K, 512. */
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function decimalsFor(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  return 5;
}

type NormalizedLevels = {
  bias: "long" | "short" | "neutral";
  entry?: number;
  stop?: number;
  tp1?: number;
  tp2?: number;
};

/** Single source of truth for the numbers shown in chat and on the Setup chart. */
function normalizePlanLevels(plan: ScanResult, last?: number): NormalizedLevels {
  const num = (s: string): number | undefined => {
    if (!s || s === "-") return undefined;
    const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : undefined;
  };
  const bias = (plan.bias === "Long" ? "long" : plan.bias === "Short" ? "short" : "neutral") as NormalizedLevels["bias"];
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
  return { bias, entry, stop, tp1, tp2 };
}

/**
 * Spell the entry out on the chart: order type (stop vs limit relative to the
 * live price), the exact price, an entry zone band, then stop and targets with
 * their R multiples. Shared by the scan pass and the sniper refinement so both
 * always draw the same way.
 */
function buildLevelAnnotations(
  bias: "long" | "short",
  entry: number,
  stop: number,
  tp1: number,
  tp2: number,
  last?: number,
): import("@/lib/chartAnnotations").ChartAnnotation[] {
  const dp = entry >= 10 ? (entry >= 100 ? 2 : 3) : entry >= 1 ? 4 : 5;
  const fmt = (v: number) => v.toFixed(dp);
  const risk = Math.abs(entry - stop) || entry * 0.001;
  const side = bias === "long" ? "BUY" : "SELL";
  let orderType = "MARKET";
  if (last && isFinite(last)) {
    const tol = Math.max(last * 0.0002, risk * 0.05);
    if (Math.abs(entry - last) > tol) {
      if (bias === "long") orderType = entry > last ? "STOP" : "LIMIT";
      else orderType = entry < last ? "STOP" : "LIMIT";
    }
  }
  const entryColor = bias === "long" ? "#22c55e" : "#ef4444";
  const band = risk * 0.12;
  const r1 = Math.abs(tp1 - entry) / risk;
  const r2 = Math.abs(tp2 - entry) / risk;
  return [
    {
      kind: "zone",
      top: entry + band,
      bottom: entry - band,
      label: `ENTRY ZONE ${fmt(entry - band)} - ${fmt(entry + band)}`,
      color: bias === "long" ? "#34d399" : "#ef4444",
    },
    {
      kind: "hline",
      price: entry,
      label: `ENTER HERE - ${side} ${orderType} @ ${fmt(entry)}`,
      color: entryColor,
    },
    { kind: "hline", price: stop, label: `STOP ${fmt(stop)} (-1R)`, color: "#ef4444", dashed: true },
    { kind: "hline", price: tp1, label: `TP1 ${fmt(tp1)} (${r1.toFixed(1)}R)`, color: "#22c55e", dashed: true },
    { kind: "hline", price: tp2, label: `TP2 ${fmt(tp2)} (${r2.toFixed(1)}R)`, color: "#22c55e", dashed: true },
  ];
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
        className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-4 py-2.5 text-sm font-semibold hover:bg-accent transition"
        title="Upload or paste a chart screenshot for the AI to scan"
      >
        <Paperclip className="h-3.5 w-3.5" /> Scan a screenshot
      </button>
    </>
  );
}

function toBacktestTf(interval: string): "15" | "60" | "240" | "D" {
  if (interval === "1" || interval === "5" || interval === "15" || interval === "30") return "15";
  if (interval === "240") return "240";
  if (interval === "D" || interval === "1D" || interval === "W") return "D";
  return "60";
}

function ScanTicket({
  result, symbol, interval, onRescan, onAttach, onStopVoice, voiceSpeaking,
}: {
  result: ScanResult;
  symbol: Symbol;
  interval: string;
  lensId: ScanLensId;
  onRescan: () => void;
  onAttach: (file: File) => void;
  onStopVoice: () => void;
  voiceSpeaking: boolean;
}) {
  const isNoEntry = result.grade === "NO ENTRY";

  const parseNum = (v?: string) => {
    const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  // Was this exact setup already saved into the journal (not just prefilled)?
  const logged = useTradeLogged({ symbol: symbol.ticker, entry: parseNum(result.entry) ?? null });

  // Compact volume / order-flow read from the research memo. The written
  // narrative (strength/weakness, coach reasoning) lives in the chat panel;
  // this card stays purely numeric and glanceable.
  const notes = result.memo?.notes ?? [];
  const riskNote = notes.find((n) => n.role === "risk");

  // Real order-flow metrics computed server-side from OHLCV.
  const of = result.orderFlow;

  // Session timing and R-multiple management for this exact plan, rendered in
  // the trader's timezone (Auto follows the device).
  const { effectiveTimezone: panelTz } = useTimezone();
  const panelTzLabel = tzAbbrev(panelTz);
  const panelTiming = computeTiming({
    symbol: symbol.ticker,
    interval,
    bias: result.bias?.toLowerCase().includes("short") ? "short" : result.bias?.toLowerCase().includes("long") ? "long" : "neutral",
    entry: parseNum(result.entry),
    stop: parseNum(result.stop),
    tp1: parseNum(result.tp1),
    tp2: parseNum(result.tp2),
  });

  // Daily bias is the direction for the day; current trend is what price is
  // doing right now. When they disagree the trader needs to know.
  const dailyBias = result.dailyBias ?? "neutral";
  const currentTrend = result.currentTrend ?? "range";
  const dailyBiasLabel = dailyBias === "bullish" ? "Bullish" : dailyBias === "bearish" ? "Bearish" : "Neutral";
  const currentTrendLabel = currentTrend === "up" ? "Up" : currentTrend === "down" ? "Down" : "Ranging";
  const biasTrendConflict =
    (dailyBias === "bullish" && currentTrend === "down") || (dailyBias === "bearish" && currentTrend === "up");

  // Volatility from the risk analyst read.
  const volatilityConf = riskNote?.confidence ?? 50;
  const volatilityTag = volatilityConf >= 65 ? "Elevated" : volatilityConf >= 40 ? "Normal" : "Quiet";

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2 truncate">
              {symbol.ticker} · {result.bias}
            </div>
            <div className={`font-display text-5xl leading-none tracking-tight ${gradeColor[result.grade]}`}>
              {result.grade}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {voiceSpeaking && (
              <button
                onClick={onStopVoice}
                className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-3.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 transition"
                title="Stop voice"
              >
                <Square className="h-3 w-3" /> Stop
              </button>
            )}
            <button
              onClick={onRescan}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 transition whitespace-nowrap"
              title="Run a new scan on the current chart"
            >
              <Crosshair className="h-3 w-3" /> New scan
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {!isNoEntry && logged && (
            <Link
              to="/journal"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-bull/40 bg-bull/10 px-4 py-2.5 text-xs font-semibold text-bull hover:bg-bull/20 transition"
              title={`Saved to your journal on ${new Date(logged.at).toLocaleString()}. Open the journal to edit it.`}
            >
              <Check className="h-3.5 w-3.5" /> You already logged this trade
            </Link>
          )}

          {!isNoEntry && !logged && (
            <button
              onClick={() => {
                takeTrade({
                  symbol: symbol.ticker,
                  bias: result.bias,
                  interval,
                  grade: result.grade,
                  rr: result.rr,
                  entry: parseNum(result.entry),
                  stop: parseNum(result.stop),
                  tp1: parseNum(result.tp1),
                  tp2: parseNum(result.tp2),
                  why: result.notes,
                  risk: result.details,
                });
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent/70 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-accent transition"
              title="Log this setup in your trade journal"
            >
              <BookOpen className="h-3.5 w-3.5" /> Log this trade
            </button>
          )}


          {!isNoEntry && (
            <PassTradeButton
              setup={{
                symbol: symbol.ticker,
                interval,
                grade: result.grade,
                bias: result.bias,
                entry: parseNum(result.entry),
                stop: parseNum(result.stop),
                tp1: parseNum(result.tp1),
              }}
            />
          )}

          <AutoBacktestVerify
            symbol={symbol.ticker}
            interval={interval}
            side={result.bias?.toLowerCase().includes("short") ? "short" : result.bias?.toLowerCase().includes("long") ? "long" : "both"}
            grade={result.grade}
            className="w-full text-left"
          />
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

      {!isNoEntry && (
        <div className="flex items-baseline justify-between rounded-2xl bg-card border border-border/50 px-3.5 py-3 text-[11px]">
          <span className="text-muted-foreground tracking-tight text-[10px]">Risk / reward</span>
          <span className="font-mono font-semibold text-foreground">{result.rr}</span>
        </div>
      )}

      {/* Audit line plus the earlier scans of this instrument, so a changed
          grade can be traced to the price and moment it was measured against. */}
      <div className="space-y-2">
        <ScanStamp
          fetchedAt={result.dataFetchedAt}
          refPrice={result.refPrice}
          dataSource={result.dataSource ?? "feed unknown"}
          candleCount={result.candleCount ?? 0}
        />
        <ScanVersionHistory symbol={symbol.ticker} interval={interval} className="w-full" />
      </div>


      {/* When to enter, when to give up on the entry, when to be flat, and how
          to scale out by R multiple. Times follow the trader's timezone. */}
      {!isNoEntry && panelTiming && (
        <MetricBlock
          title="Timing and management"
          tag={panelTiming.live ? "Window open" : "Window later"}
          tone={panelTiming.live ? "good" : "neutral"}
        >
          <MetricRow label="Session" value={panelTiming.session} />
          <MetricRow label="Enter from" value={clockLabel(panelTiming.enterFrom, panelTz)} />
          <MetricRow label="Enter before" value={clockLabel(panelTiming.enterUntil, panelTz)} />
          <MetricRow label="Cancel if unfilled" value={clockLabel(panelTiming.cancelIfUnfilled, panelTz)} />
          <MetricRow label="Exit by" value={clockLabel(panelTiming.exitBy, panelTz)} />
          <MetricRow label="Expected hold" value={panelTiming.holdTime} />
          <MetricRow label="TP1 / TP2 in R" value={`${panelTiming.tp1R.toFixed(1)}R / ${panelTiming.tp2R.toFixed(1)}R`} />
          <p className="pt-1 text-[10px] leading-relaxed text-foreground">{panelTiming.ratioAdvice}</p>
          <div className="space-y-1 pt-1">
            {panelTiming.scale.map((s2) => (
              <div key={s2.label} className="flex items-baseline gap-2 text-[10px]">
                <span className="w-14 shrink-0 font-semibold tracking-wider text-muted-foreground">{s2.label}</span>
                <span className="font-mono text-foreground">{s2.price}</span>
                <span className="text-muted-foreground">{s2.action}</span>
              </div>
            ))}
          </div>
          <p className="pt-1 text-[10px] text-muted-foreground">
            All times in {panelTz}{panelTzLabel ? ` (${panelTzLabel})` : ""}.
          </p>
        </MetricBlock>
      )}

      {/* Daily bias and current trend - they can disagree, and that matters */}
      <MetricBlock
        title="Bias and trend"
        tag={biasTrendConflict ? "Conflict" : "Aligned"}
        tone={biasTrendConflict ? "bad" : "neutral"}
      >
        <MetricRow label="Daily bias (today)" value={dailyBiasLabel} />
        <MetricRow label="Current trend (4H)" value={currentTrendLabel} />
        {biasTrendConflict && (
          <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
            Price is moving against the daily bias, so it is travelling into the level rather than away from it. Wait
            for confirmation on the lower timeframe.
          </p>
        )}
      </MetricBlock>

      {/* Real order flow: delta, CVD, VPOC, imbalance, depth */}
      <MetricBlock
        title={of ? (of.estimated ? "Order flow (estimated)" : "Order flow") : "Order flow"}
        tag={of ? (of.bias === "bullish" ? "Buyers in control" : of.bias === "bearish" ? "Sellers in control" : "Balanced") : "No data"}
        tone={of ? (of.bias === "bullish" ? "good" : of.bias === "bearish" ? "bad" : "neutral") : "muted"}
      >
        {of ? (
          <>
            <MetricRow label="Delta (last bar)" value={`${of.delta >= 0 ? "+" : ""}${fmtCompact(of.delta)}`} />
            <MetricRow
              label="Cumulative volume delta"
              value={`${of.cvd >= 0 ? "+" : ""}${fmtCompact(of.cvd)} · ${of.cvdSlope >= 0 ? "rising" : "falling"}`}
            />
            <MetricRow label="Volume point of control" value={of.poc.toLocaleString()} />
            <MetricRow
              label="Volume imbalance"
              value={`${of.buyPct.toFixed(0)}% buy / ${(100 - of.buyPct).toFixed(0)}% sell${of.stackedSide !== "none" ? ` · ${of.stackedImbalances} stacked ${of.stackedSide}` : ""}`}
            />
            <MetricRow label="Market depth" value={`${of.depth} · ${of.lastVolRatio.toFixed(2)}x average`} />
            <MetricRow label="Value area" value={`${of.valueAreaLow.toLocaleString()} to ${of.valueAreaHigh.toLocaleString()}`} />
            <MetricRow label="Price vs point of control" value={of.priceVsPoc} />
            {of.estimated && (
              <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                This feed does not publish volume for this instrument, so these figures are derived from bar range and
                close position. Treat them as directional, not exact.
              </p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No volume data available for this instrument on this timeframe.
          </p>
        )}
      </MetricBlock>

      {/* Volatility */}
      <MetricBlock title="Volatility" tag={volatilityTag} tone={volatilityConf >= 65 ? "bad" : "neutral"}>
        <MetricRow label="Risk read" value={volatilityTag} />
        {riskNote?.summary && <MetricRow label="Note" value={riskNote.summary.slice(0, 80)} />}
      </MetricBlock>

      {/* Why this grade - built from the real numbers, not generic bullets */}
      {result.synopsis && (
        <div className="rounded-2xl border border-border/60 bg-background/30 p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold mb-1.5">
            Why this grade
          </div>
          <p className="text-[11px] leading-relaxed text-foreground/90">{result.synopsis}</p>
        </div>
      )}

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
  const tagColor = tone === "good" ? "text-bull bg-bull/12"
    : tone === "bad" ? "text-destructive bg-destructive/12"
    : tone === "muted" ? "text-muted-foreground bg-accent/60"
    : "text-foreground/80 bg-accent/60";
  return (
    <div className="rounded-2xl bg-card border border-border/50 p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">{title}</span>
        <span className={`text-[10px] font-semibold tracking-tight rounded-full px-2 py-0.5 ${tagColor}`}>{tag}</span>
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
    <div className="rounded-2xl bg-card border border-border/50 px-3.5 py-3">
      <div className="text-[10px] tracking-tight text-muted-foreground mb-0.5">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

const ALL_LEVELS: LevelKey[] = ["VWAP","POC","SR","ZONES","FVG","FIB","LIQ","OF","CISD","OB"];

const STORAGE_KEY = "trademind.levels.enabled.v3";
const SESSIONS_STORAGE_KEY = "trademind.sessions.enabled.v1";

const DEFAULT_LEVELS: Record<LevelKey, boolean> = { VWAP: false, POC: false, SR: false, ZONES: false, FVG: false, FIB: false, LIQ: false, OF: false, CISD: false, OB: false };

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
  // Analysis timing is rendered in the trader's timezone; "Auto" tracks the
  // device so a timezone change (travel, DST, OS setting) is picked up live.
  const { timezone, effectiveTimezone: tz, setTimezone } = useTimezone();
  const tzLabel = tzAbbrev(tz);

  
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
      const key = `trademind.scanResult.${symbol.ticker}`;
      const raw = window.sessionStorage.getItem(key);
      if (!raw) {
        setResult(null);
        return;
      }
      const saved = JSON.parse(raw) as ScanResult;
      // Older builds could write the previous instrument's result into the new
      // instrument's storage key during the symbol-change render. Never display
      // or preserve a result unless its research memo belongs to this symbol.
      if (saved.memo?.ticker !== symbol.ticker) {
        window.sessionStorage.removeItem(key);
        setResult(null);
        return;
      }
      setResult(saved);
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
      // On a symbol change React renders once with the old result before the
      // loader effect above replaces it. The memo check prevents that stale
      // result from being copied into every symbol's storage slot.
      if (result?.memo?.ticker === symbol.ticker) {
        window.sessionStorage.setItem(`trademind.scanResult.${symbol.ticker}`, JSON.stringify(result));
      }
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
  const [chatPanelView, setChatPanelView] = useState<"conversation" | "history">("conversation");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => readLastThreadId());
  const [rightOpen, setRightOpen] = useState(true);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  // Chat panel width is a free drag (Claude-style): the trader decides how much
  // room the conversation gets versus the chart. Persisted per browser.
  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 460;
    const raw = Number(window.localStorage.getItem("tm_chat_panel_w"));
    return Number.isFinite(raw) && raw >= 280 ? raw : 460;
  });
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("tm_chat_panel_w", String(Math.round(chatWidth)));
  }, [chatWidth]);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const max = Math.max(360, window.innerWidth - 360);
      setChatWidth(Math.min(max, Math.max(300, window.innerWidth - ev.clientX)));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const narrowPanel = chatWidth < 360;
  // "split" = chart + chat side by side. "chat" = chart minimized, chat full width.
  // "chart" = chat minimized to a rail, chart full width.
  const [layout, setLayout] = useState<"split" | "chat" | "chart">("split");
  const chatHalf = layout === "chat";


  useEffect(() => {
    if (activeThreadId) writeLastThreadId(activeThreadId);
  }, [activeThreadId]);

  // Our own OANDA-fed chart is the default: the TradingView embed is blocked in
  // some browsers/networks and painted a black panel, so it is now opt-in.
  const [chartTab, setChartTab] = useState<"live" | "setup">("setup");
  // Mobile-only: which pane is visible full-height (chart / scan / chat). On >=lg
  // both are shown side-by-side and this state is ignored.
  const [mobileView, setMobileView] = useState<"chart" | "scan" | "chat">("chart");
  const [candleType, setCandleType] = useState<CandleStyleId>(() => {
    if (typeof window === "undefined") return "candle";
    const saved = window.localStorage.getItem("trademind:candleStyle");
    return (saved && CANDLE_STYLES.some((s) => s.id === saved) ? saved : "candle") as CandleStyleId;
  });
  useEffect(() => {
    try { window.localStorage.setItem("trademind:candleStyle", candleType); } catch { /* ignore */ }
  }, [candleType]);
  const [snapshot, setSnapshot] = useState<ChartSnapshot | null>(null);
  // Latest market price, readable from stable callbacks without re-creating them.
  const snapshotPriceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    snapshotPriceRef.current = typeof snapshot?.lastPrice === "number" ? snapshot.lastPrice : undefined;
  }, [snapshot?.lastPrice]);
  const [aiAnnotationsRaw, setAiAnnotationsRaw] = useState<import("@/lib/chartAnnotations").ChartAnnotation[]>([]);
  const [aiConcept, setAiConcept] = useState<import("@/lib/chartAnnotations").ConceptRef | null>(null);
  const [aiGrade, setAiGrade] = useState<import("@/lib/chartAnnotations").ChartGrade | null>(null);
  const handleChatAnnotations = useCallback((annotations: import("@/lib/chartAnnotations").ChartAnnotation[]) => {
    setAiAnnotationsRaw(annotations);
    if (annotations.length > 0) setChartTab("setup");
  }, []);
  const handleShowMe = useCallback(() => setChartTab("setup"), []);
  // A grade card arriving from chat becomes the chart. Scan-engine cards
  // (they carry a dataSource) are already validated and clamped once inside the
  // chat panel, so re-clamping them here is what produced a second entry price
  // that disagreed with the card the trader was reading. Free-form coach cards
  // still get sanitized. Either way the entry/stop/target lines are rebuilt
  // from the very numbers shown on the card.
  const handleChatGrade = useCallback((incoming: import("@/lib/chartAnnotations").ChartGrade | null) => {
    const grade = enforceGradeDirection(incoming?.dataSource ? incoming : sanitizeVisibleGrade(incoming));
    setAiGrade(grade);
    const bias = grade?.bias === "long" || grade?.bias === "short" ? grade.bias : null;
    const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
    const entry = num(grade?.entry);
    const stop = num(grade?.stop);
    const tp1 = num(grade?.tp1);
    const risk = entry !== undefined && stop !== undefined ? Math.abs(entry - stop) : undefined;
    const tp2 =
      num(grade?.tp2) ??
      (entry !== undefined && risk ? (bias === "short" ? entry - risk * 3 : entry + risk * 3) : undefined);
    if (bias && entry && stop && tp1 && tp2) {
      setAiAnnotationsRaw(buildLevelAnnotations(bias, entry, stop, tp1, tp2, snapshotPriceRef.current));
      setChartTab("setup");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const activeScanRequestRef = useRef(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const [lensId, setLensId] = useState<ScanLensId>("wyckoff");
  const [lensOpen, setLensOpen] = useState(false);
  const coachRef = useRef<HTMLDivElement>(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const strategyRef = useRef<HTMLDivElement>(null);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [activeStrategy, setActiveStrategy] = useState<string | null>(null);
  useEffect(() => { setActiveStrategy(readActiveStrategy()); }, []);
  const strategyOptions = useMemo(
    () => allStrategies().map((s) => ({ name: s.name, blurb: s.description ?? "" })),
    [strategyOpen],
  );
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
      if (strategyRef.current && !strategyRef.current.contains(e.target as Node)) setStrategyOpen(false);
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
    writeLastChart({ ticker: symbolLabel(symbol), intervalLabel, enabledLevels, tvSymbol: symbol.tv, interval });
  }, [symbol, intervalLabel, interval, levels]);


  // Invalidate any in-flight scan as soon as the chart context changes. A
  // slower response for the previous instrument/timeframe must never replace
  // the result on the chart the trader is viewing now.
  useEffect(() => {
    activeScanRequestRef.current += 1;
    setScanning(false);
  }, [symbol.ticker, interval]);

  const runPlan = useServerFn(runResearchPlan);
  const reportSystemNoticeFn = useServerFn(reportSystemNotice);
  const createChatThreadFn = useServerFn(createChatThread);

  // Free-plan grade quota. Paid and admin accounts get an inactive quota, so the
  // badge and paywall below simply never render for them.
  const ent = useEntitlements();
  const [paywall, setPaywall] = useState(false);

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
  const [pendingScanTicker, setPendingScanTicker] = useState<string | null>(null);
  useEffect(() => {
    const t = search.symbol?.trim();
    if (!t || symbolAppliedRef.current === t) return;
    const match = SYMBOLS.find((s) => s.ticker.toLowerCase() === t.toLowerCase() || s.tv.toLowerCase() === t.toLowerCase());
    if (match) {
      setSymbol(match);
      symbolAppliedRef.current = t;
      // Clicking an instrument in AI Signals should re-run the scan for that
      // instrument and drop the trader straight into the chat conversation.
      if (search.scan === "1") setPendingScanTicker(match.ticker);
    }
    navigate({ to: "/dashboard", search: (prev: DashboardSearch) => ({ ...prev, symbol: undefined, scan: undefined }), replace: true });
  }, [search.symbol, search.scan, navigate]);



  // One conversation per instrument. Switching the instrument on the chart opens
  // a brand new chat titled after that instrument, so a Gold conversation never
  // continues into a NAS100 scan and history entries stay identifiable.
  const threadSymbolRef = useRef<string>(symbol.ticker);
  useEffect(() => {
    if (threadSymbolRef.current === symbol.ticker) return;
    threadSymbolRef.current = symbol.ticker;
    const title = historyInstrumentTitle(symbol);
    let cancelled = false;
    setChatPanelView("conversation");
    (async () => {
      try {
        const t = await createChatThreadFn({ data: { title } });
        if (!cancelled && t?.id) setActiveThreadId(t.id);
      } catch {
        // non-fatal: the next scan/message still creates a thread
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol.ticker]);




  // Honor ?thread= deep links (e.g. "AI chat" button on a journal trade)
  const threadAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const id = search.thread?.trim();
    if (!id || threadAppliedRef.current === id) return;
    threadAppliedRef.current = id;
    setActiveThreadId(id);
    setChatPanelView("conversation");
    setRightTab("chat");
    setRightOpen(true);
    setMobileView("chat");
    navigate({ to: "/dashboard", search: (prev: DashboardSearch) => ({ ...prev, thread: undefined }), replace: true });
  }, [search.thread, navigate]);


  // Chat and the Setup chart must never show different prices for the same
  // scan. The levels are clamped against the live price once, cached per plan,
  // and then reused by both surfaces even if the price ticks afterwards.
  const planLevelsRef = useRef<{ key: string; levels: NormalizedLevels } | null>(null);

  const levelsForPlan = (plan: ScanResult): NormalizedLevels => {
    const key = [plan.grade, plan.bias, plan.entry, plan.stop, plan.tp1, plan.tp2, plan.rr, plan.dataFetchedAt ?? ""].join("|");
    const cached = planLevelsRef.current;
    if (cached && cached.key === key) return cached.levels;
    const levels = normalizePlanLevels(plan, snapshot?.lastPrice);
    planLevelsRef.current = { key, levels };
    return levels;
  };

  const applyPlanToSignalCards = (plan: ScanResult) => {
    const last = snapshot?.lastPrice;
    const { bias, entry, stop, tp1, tp2 } = levelsForPlan(plan);

    setAiGrade(enforceGradeDirection({
      grade: plan.grade,
      bias,
      confidence: typeof plan.confidence === "number" ? plan.confidence : undefined,
      entry,
      stop,
      tp1,
      tp2,
      strength: plan.notes,
      weakness: plan.details,
      dataSource: plan.dataSource,
      dataFetchedAt: plan.dataFetchedAt,
      candleCount: plan.candleCount,
      refPrice: typeof plan.refPrice === "number" ? plan.refPrice : last,
    }));
    if (entry && stop && tp1 && tp2 && bias !== "neutral") {
      setAiAnnotationsRaw(buildLevelAnnotations(bias, entry, stop, tp1, tp2, last));


      // TradingView (Live) can't render our markers, so a scan always drops the
      // chart onto the Setup view where entry/stop/TP lines are drawn. Without
      // this, desktop stayed on Live and the marked-up chart never appeared.
      setChartTab("setup");
    } else {
      setAiAnnotationsRaw([]);
    }

    // Record every scan so the signal history shows previous signals.
    recordSignal({
      symbol: symbol.ticker,
      interval,
      grade: plan.grade,
      bias: plan.bias,
      entry,
      stop,
      tp1,
      tp2,
      rr: plan.rr,
      synopsis: plan.synopsis ?? plan.notes,
      source: "chart",
      confidence: typeof plan.confidence === "number" ? plan.confidence : null,
      strategyId: readActiveStrategy() ?? null,
      refPrice: typeof plan.refPrice === "number" ? plan.refPrice : (snapshot?.lastPrice ?? null),
      dataSource: plan.dataSource ?? null,
      counterTrend: plan.counterTrend ?? false,
      htfBias: plan.htfBias ?? null,
    });

  };

  const scanResultToChatText = (plan: ScanResult, scanSymbol: Symbol) => {
    const last = snapshot?.lastPrice;
    const { bias, entry, stop, tp1, tp2 } = levelsForPlan(plan);
    const dec = decimalsFor(last || entry || 1);

    const safeEntry = entry === undefined ? plan.entry : fmtPrice(entry, dec);
    const safeStop = stop === undefined ? plan.stop : fmtPrice(stop, dec);
    const safeTp1 = tp1 === undefined ? plan.tp1 : fmtPrice(tp1, dec);
    const safeTp2 = tp2 === undefined ? plan.tp2 : fmtPrice(tp2, dec);
    const scanTiming = computeTiming({
      symbol: scanSymbol.ticker,
      interval,
      bias,
      entry,
      stop,
      tp1,
      tp2,
    });
    // Levels are rounded to the instrument's own precision so saved cards and
    // the AI context recap never show float noise like 4348.450000000001.
    const round = (v: number | undefined) =>
      typeof v === "number" && isFinite(v) ? Number(v.toFixed(dec)) : v;
    const gradePayload = {
      // Symbol and timeframe travel with the card so the context inspector and
      // the coach's recap can name the instrument the scan belongs to.
      symbol: scanSymbol.name,
      ticker: scanSymbol.ticker,
      timeframe: intervalLabel,
      grade: plan.grade,
      bias,
      confidence: plan.confidence,
      entry: round(entry),
      stop: round(stop),
      tp1: round(tp1),
      tp2: round(tp2),
      strength: plan.notes,
      weakness: plan.details,
      dataSource: plan.dataSource,
      dataFetchedAt: plan.dataFetchedAt,
      candleCount: plan.candleCount,
      refPrice: round(typeof plan.refPrice === "number" ? plan.refPrice : last),
    };
    const levelLines = plan.grade === "NO ENTRY"
      ? ["No entry - stand down until the setup improves."]
      : [
          `Entry: ${safeEntry}`,
          `Stop: ${safeStop}`,
          `TP1: ${safeTp1}`,
          `TP2: ${safeTp2}`,
          `R:R: ${plan.rr}`,
          ...(scanTiming
            ? [
                `Timing (${tzLabel}): enter between ${clockLabel(scanTiming.enterFrom, tz)} and ${clockLabel(scanTiming.enterUntil, tz)} during the ${scanTiming.session}. Cancel the order if unfilled by ${clockLabel(scanTiming.cancelIfUnfilled, tz)}. Exit by ${clockLabel(scanTiming.exitBy, tz)}; expected hold ${scanTiming.holdTime}.`,
                `Management: ${scanTiming.ratioAdvice} ${scanTiming.scale.map((s2) => `${s2.label} at ${s2.price} - ${s2.action}`).join("; ")}.`,
              ]
            : []),
        ];
    return [
      `${scanSymbol.name} scan: ${plan.grade} ${plan.bias}. Confidence ${plan.confidence}%.`,
      `Market data: ${plan.dataSource ?? "unavailable"}, ${plan.candleCount ?? 0} real candles, fetched ${plan.dataFetchedAt ?? "unknown"}, market price used ${typeof (plan.refPrice ?? last) === "number" ? fmtPrice((plan.refPrice ?? last) as number, dec) : "unknown"}.`,
      ...levelLines,
      `Why take this trade: ${plan.notes}`,
      ...(plan.details && plan.details !== plan.notes ? [`Risk and invalidation: ${plan.details}`] : []),
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
    // Free plan: the 4th grade opens the paywall instead of running. Nothing is
    // consumed here - the charge happens only once an answer is delivered.
    if (ent.gradesExhausted) {
      setPaywall(true);
      return;
    }
    const requestId = ++activeScanRequestRef.current;
    const scanSymbol = symbol;
    const scanInterval = interval;
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
    // Keep the scan in the conversation the trader is already having. Starting a
    // fresh thread per scan split trade-management chats across many history
    // entries and wiped the coach's memory of what was just discussed, so a new
    // thread is only created when there is no active conversation yet.
    let scanThreadId: string | null = activeThreadId;
    if (!scanThreadId) {
      try {
        const t = await createChatThreadFn({ data: { title: `${historyInstrumentTitle(symbol)} Scan` } });
        if (t?.id) {
          scanThreadId = t.id;
          setActiveThreadId(t.id);
        }
      } catch {
        // non-fatal - fall through with existing thread
      }
    }
    // Always post the scan prompt to chat so the user sees activity immediately.
    sendToChat(prompt, { focusChat: from === "chat", targetThreadId: scanThreadId });

    runPlan({ data: { ticker: scanSymbol.ticker, interval: scanInterval, lensDesc: `${lens.name}: ${lens.promptEmphasis}`, strategyDesc: activeStrategyDesc(), strategyId: readActiveStrategy() ?? undefined, coach: readActiveCoach(), journalPerf: formatJournalPerf(scanSymbol.ticker) ?? undefined } })
      .then((plan) => {
        const r = plan as ScanResult;
        if (requestId !== activeScanRequestRef.current) return;
        if (r.memo?.ticker !== scanSymbol.ticker || r.memo?.interval !== scanInterval) {
          throw new Error(`Scan response mismatch: requested ${scanSymbol.ticker} ${scanInterval}`);
        }
        setResult(r);
        applyPlanToSignalCards(r);
        // Single source of truth: the Analysis engine's grade card is always
        // appended to the chat thread so Chat and Analysis never disagree.
        const replyText = scanResultToChatText(r, scanSymbol);
        chatRef.current?.appendScanReply(replyText, scanThreadId);
        // Charged only now, once a real answer exists. A legitimate "No Entry"
        // is a real answer and does count; the server also de-dupes an identical
        // re-scan inside ten minutes so it stays free.
        void ent.recordScanOutcome(r.grade === "NO ENTRY" ? "no_entry" : "graded", {
          symbol: scanSymbol.ticker,
          timeframe: scanInterval,
          methodology: lens.name,
        });
      })
      .catch(() => {
        if (requestId !== activeScanRequestRef.current) return;
        // Log a system notice so the trader can see the failure in their inbox
        // later (deduped server-side to once every few hours).
        void reportSystemNoticeFn({ data: { reason: "scan_failed", detail: `${scanSymbol.ticker} ${scanInterval}` } })
          .catch(() => { /* best-effort */ });
        // Our failure, so it costs the trader nothing.
        void ent.recordScanOutcome("error");
        setResult({
          grade: "NO ENTRY", bias: "Neutral", confidence: 0,
          notes: "Research service is temporarily unavailable. Please try again in a moment.",
          entry: "-", stop: "-", tp1: "-", tp2: "-", rr: "-",
          details: "The analysis engine couldn't be reached. Your chart and levels are unaffected.",
        });
      })
      .finally(() => {
        if (requestId !== activeScanRequestRef.current) return;
        setScanning(false);
        setLastUpdatedAt(Date.now());
      });
  };



  // Deep-linked scan (?symbol=X&scan=1): wait until the chart is actually on
  // that instrument, then run the scan straight into the chat conversation.
  const runScanRef = useRef(runScan);
  runScanRef.current = runScan;
  useEffect(() => {
    if (!pendingScanTicker) return;
    if (symbol.ticker !== pendingScanTicker) return;
    setPendingScanTicker(null);
    const id = window.setTimeout(() => { void runScanRef.current("chat"); }, 250);
    return () => window.clearTimeout(id);
  }, [pendingScanTicker, symbol.ticker]);










  const toggleLevel = (k: LevelKey) => setLevels((p) => ({ ...p, [k]: !p[k] }));
  const enabledCount = ALL_LEVELS.filter((k) => levels[k]).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Row 1: symbol + timeframes + right-side pickers */}
      <div className="shrink-0 flex items-center gap-4 px-5 py-3 border-b border-border/50 bg-background">


        <div className="relative shrink-0" ref={pickerRef} data-tour="symbol-picker">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm hover:bg-accent/60 transition"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            <span className="h-2 w-2 rounded-full bg-bull" />
            <span className="font-display text-base font-semibold tracking-tight uppercase">{symbol.ticker.replace("/", "").replace("XAUUSD", "GOLD")}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
          {pickerOpen && (
            <div role="listbox" className="absolute left-0 mt-2 w-[min(18rem,calc(100vw-2rem))] max-h-80 overflow-y-auto rounded-2xl border border-border/60 bg-card shadow-xl z-50">
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
        <div className="flex items-center gap-0.5 overflow-x-auto min-w-0 rounded-full bg-accent/60 p-1">
          {INTERVALS.map((i) => (
            <button
              key={i.value}
              onClick={() => setIntervalState(i.value)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                interval === i.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Right-side pickers: Wyckoff (lens), The Analyst (coach) */}
        <div className="hidden md:flex items-center gap-2 shrink-0">

          <div className="relative" ref={lensRef}>
            <button
              onClick={() => setLensOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-full h-9 bg-accent/60 px-3.5 text-xs font-medium text-foreground hover:bg-accent transition"
              title="Scan lens"
            >
              <Crosshair className="h-3.5 w-3.5 text-primary" />
              <span>{activeLens.name}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${lensOpen ? "rotate-180" : ""}`} />
            </button>
            {lensOpen && (
              <div role="listbox" className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto rounded-2xl border border-border/60 bg-card shadow-xl z-50">
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
                  className="inline-flex items-center gap-1.5 rounded-full h-9 bg-accent/60 px-3.5 text-xs font-medium text-foreground hover:bg-accent transition"
                  title="Change active AI coach"
                >
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-xl ${meta.iconBg} ${meta.iconText} shrink-0`}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <span>{activeCoach}</span>
                  <ChevronDown className={`h-3 w-3 transition-transform ${coachOpen ? "rotate-180" : ""}`} />
                </button>
                {coachOpen && (
                  <div role="listbox" className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto rounded-2xl border border-border/60 bg-card shadow-xl z-50">
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
                              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-xl ${m.iconBg} ${m.iconText} shrink-0`}>
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

          {/* Active strategy playbook - sits beside the coach so both pieces of
              scan context are changeable from the same bar. */}
          <div className="relative" ref={strategyRef}>
            <button
              onClick={() => setStrategyOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-full h-9 bg-accent/60 px-3.5 text-xs font-medium text-foreground hover:bg-accent transition"
              title="Change the strategy playbook your scans are graded against"
            >
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              <span className="max-w-[9rem] truncate">{activeStrategy ?? "No strategy"}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${strategyOpen ? "rotate-180" : ""}`} />
            </button>
            {strategyOpen && (
              <div role="listbox" className="absolute right-0 mt-2 w-72 max-h-96 overflow-y-auto rounded-2xl border border-border/60 bg-card shadow-xl z-50">
                <button
                  role="option"
                  aria-selected={!activeStrategy}
                  onClick={() => { writeActiveStrategy(null); setActiveStrategy(null); setStrategyOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/40 hover:bg-accent/40 transition ${!activeStrategy ? "bg-primary/10 text-primary" : ""}`}
                >
                  No strategy
                  <div className="text-[11px] text-muted-foreground mt-0.5">Grade on raw structure only.</div>
                </button>
                {strategyOptions.map((s) => {
                  const isActive = s.name === activeStrategy;
                  return (
                    <button
                      key={s.name}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        writeActiveStrategy(s.name);
                        setActiveStrategy(s.name);
                        setStrategyOpen(false);
                        if (!isActive) toast.success(`Scans now graded against ${s.name}`);
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/40 last:border-0 hover:bg-accent/40 transition ${isActive ? "bg-primary/10 text-primary" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{s.name}</span>
                        {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </div>
                      {s.blurb && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{s.blurb}</div>
                      )}
                    </button>
                  );
                })}
                <Link to="/strategies" search={{ edit: undefined }} className="block px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground border-t border-border/60">
                  Manage all strategies →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 2: Live / Setup segmented control + chart controls */}
      <div className={`shrink-0 items-center gap-3 px-5 py-3 border-b border-border/50 bg-background text-xs ${chatHalf ? "flex lg:hidden" : "flex"}`}>
        <div className="inline-flex items-center rounded-full bg-accent/60 p-1">
          <button
            onClick={() => setChartTab("live")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
              chartTab === "live" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Activity className="h-3.5 w-3.5" /> Live
          </button>
          <button
            onClick={() => { setChartTab("setup"); setIntervalState("60"); }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
              chartTab === "setup" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" /> Setup
          </button>
        </div>

        <button
          type="button"
          onClick={toggleChartFullscreen}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/60 hover:text-foreground transition"
          title={isChartFullscreen ? "Exit full screen" : "Full screen chart"}
          aria-label={isChartFullscreen ? "Exit full screen" : "Full screen chart"}
        >
          {isChartFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </button>

        <StrategyPresetCard name={activeStrategy} className="min-w-0 flex-1" />

        {/* Single "View" popover holding candle style, sessions, and indicators */}
        <div className="relative" ref={viewMenuRef}>
          <button
            onClick={() => setViewMenuOpen((o) => !o)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent/60 px-3.5 text-[11px] font-medium text-foreground/80 hover:bg-accent hover:text-foreground transition"
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
            <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-border/60 bg-card shadow-xl z-50 p-3 space-y-3">
              <div className="text-[10px] text-muted-foreground italic border-b border-border/40 pb-2">
                Levels apply to Live where supported and fully on Setup.
              </div>

              {/* Candle / chart display style — all 21 options */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-foreground/80">Candle style</span>
                  <span className="text-[10px] text-muted-foreground">
                    {CANDLE_STYLE_MAP[candleType]?.label ?? "Candles"}
                  </span>
                </div>
                <div className="max-h-44 overflow-y-auto pr-0.5 grid grid-cols-2 gap-1">
                  {CANDLE_STYLES.map((s) => {
                    const on = candleType === s.id && chartTab === "setup";
                    return (
                      <button
                        key={s.id}
                        disabled={chartTab !== "setup"}
                        onClick={() => setCandleType(s.id)}
                        title={s.hint}
                        className={`text-left rounded-xl border px-2 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                          on
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-border/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                {chartTab !== "setup" && (
                  <div className="mt-1 text-[10px] text-muted-foreground">Switch to Setup to change the style.</div>
                )}
              </div>

              {/* Sessions */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground/80 inline-flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> Sessions
                </span>
                <button
                  disabled={chartTab !== "setup"}
                  onClick={() => setSessionsOn((v) => !v)}
                  className={`inline-flex items-center rounded-xl border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-40 ${
                    sessionsOn && chartTab === "setup"
                      ? "border-bull/40 bg-bull/10 text-bull"
                      : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground"
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
                        className={`rounded-xl border px-1.5 py-1 text-[11px] font-medium transition ${
                          on ? meta.tone : "border-border/60 text-muted-foreground hover:text-foreground"
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

        <label
          className="hidden lg:inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-3 text-xs font-medium text-muted-foreground"
          title={`Analysis times are shown in ${tz}. Auto follows your device, so a timezone change is picked up automatically.`}
        >
          <Clock className="h-3 w-3" />
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="bg-transparent text-xs font-medium text-foreground outline-none dark:[color-scheme:dark]"
          >
            {TIMEZONE_OPTIONS.map((o) => (
              <option
                key={o.value}
                value={o.value}
                className="bg-background text-foreground"
                style={{ backgroundColor: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              >
                {o.label}
              </option>
            ))}
          </select>
          <span className="font-mono text-[10px] text-muted-foreground">{tzLabel}</span>
        </label>

        <UpgradeModal
          open={paywall}
          onClose={() => setPaywall(false)}
          reason="grades"
          used={ent.quota.used}
          limit={ent.quota.limit}
        />

        <QuotaBadge quota={ent.quota} className="hidden lg:inline-flex" />

        <button
          onClick={scanning ? () => { chatRef.current?.stop(); voice.stop(); setScanning(false); } : () => runScan("analysis")}
          className={`hidden lg:inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-xs font-semibold transition ${
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
          className="hidden lg:inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent/60 px-4 text-xs font-semibold text-foreground hover:bg-accent transition"
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
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-semibold transition ${
                active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          );
        })}
      </div>

      {/* Chart area */}
      <div ref={chartAreaRef} className={`flex-1 min-h-0 bg-card overflow-hidden ${mobileView === "chart" ? "flex" : "hidden"} lg:flex`} data-tour="chart">

        {/* Chart column. Minimized (collapsed to a restore rail) when the chat is maximized. */}
        {chatHalf && rightOpen && !isChartFullscreen && (
          <div className="hidden lg:flex w-10 shrink-0 flex-col items-center gap-2 border-r border-border/50 bg-card py-3">
            <button
              type="button"
              onClick={() => setLayout("split")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/60 hover:text-foreground transition"
              title="Restore chart"
              aria-label="Restore chart"
            >
              <LineChart className="h-4 w-4" />
            </button>
            <span className="mt-1 text-[10px] font-semibold tracking-widest text-muted-foreground [writing-mode:vertical-rl]">CHART</span>
          </div>
        )}

        <div className={`flex-1 min-w-0 flex-col ${chatHalf && rightOpen && !isChartFullscreen ? "flex lg:hidden" : "flex"}`}>

          {/* Scan output preview + live performance strip */}
          {!isChartFullscreen && (
            <div className="space-y-3">
              <ChartSignalCards
                grade={aiGrade}
                lastPrice={snapshot?.lastPrice}
                symbol={symbol.ticker}
                interval={interval}
                scanning={scanning}
                onClear={aiGrade ? () => { setAiGrade(null); setAiAnnotationsRaw([]); } : undefined}
                onApplySniper={({ entry, stop, tp1, tp2, notes }) => {
                  const bias = aiGrade?.bias === "short" ? "short" : "long";

                  setAiGrade((prev) => (prev ? enforceGradeDirection({ ...prev, entry, stop, tp1, tp2, strength: notes || prev.strength }) : prev));
                  setAiAnnotationsRaw(buildLevelAnnotations(bias, entry, stop, tp1, tp2, snapshot?.lastPrice));
                  setChartTab("setup");
                }}

              />

              
            </div>
          )}


          <div className="flex-1 min-h-0 overflow-hidden relative">
            {chartTab === "live" ? (
              <TradingViewChart
                symbol={symbol.tv}
                interval={interval}
                enabled={levels}
                sessions={sessionsOn}
                fallback={
                  <NativeChart
                    symbol={symbol.tv}
                    ticker={symbol.ticker}
                    interval={interval}
                    enabled={levels}
                    sessions={sessionsOn}
                    onSnapshot={setSnapshot}
                    annotations={aiAnnotations}
                    candleType={candleType}
                  />
                }
              />

            ) : (
              <NativeChart symbol={symbol.tv} ticker={symbol.ticker} interval={interval} enabled={levels} sessions={sessionsOn} onSnapshot={setSnapshot} annotations={aiAnnotations} candleType={candleType} />
            )}

            {/* Exit-fullscreen floater (only visible in fullscreen, top-left so it never covers TradingView's camera button) */}
            {isChartFullscreen && (
              <button
                type="button"
                onClick={toggleChartFullscreen}
                className="absolute left-3 top-3 z-40 rounded-xl border border-border/60 bg-background/90 px-2 py-1 text-[10px] font-mono tracking-tight text-muted-foreground hover:text-foreground backdrop-blur inline-flex items-center gap-1"
                title="Exit full screen"
                aria-label="Exit full screen"
              >
                <Minimize className="h-3 w-3" /> Exit
              </button>
            )}

            {chartTab === "live" && aiAnnotations.length > 0 && (
              <div className="pointer-events-none absolute left-3 top-12 z-20 rounded-xl border border-primary/40 bg-background/90 px-2 py-1 text-[10px] font-mono tracking-tight text-primary backdrop-blur">
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
                className="absolute right-3 top-12 z-30 rounded-xl border border-border/60 bg-background/90 px-2 py-1 text-[10px] font-mono tracking-tight text-muted-foreground hover:text-foreground backdrop-blur"
              >
                Clear markers
              </button>
            )}
          </div>

          {/* Buy / Sell on TradingView - shown under both Live and Setup charts */}
          {!isChartFullscreen && (
            <ChartTradeBar
              tvSymbol={symbol.tv}
              ticker={symbol.ticker}
              interval={interval}
              bias={aiGrade?.bias}
            />
          )}





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
                  <span className="truncate">Chart-only mode. <Link to="/broker" className="text-primary hover:underline">Connect broker</Link></span>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Minimized chat — floating bubble, bottom-right. Chat is never destroyed, just collapsed. */}
        {!rightOpen && !isChartFullscreen && (
          <button
            type="button"
            onClick={() => { setRightOpen(true); setLayout("split"); }}
            title="Open chat"
            aria-label="Open chat"
            className="hidden lg:inline-flex fixed bottom-6 right-6 z-40 items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg shadow-black/30 transition hover:brightness-110 active:scale-95"
          >
            <MessageSquare className="h-5 w-5" />
            <span className="text-sm font-semibold">Chat</span>
          </button>
        )}


        {/* Kept mounted while hidden so the live conversation (including the
            reply that is still streaming) survives Hide Chat / Open Chat. */}

          {/* Drag handle: grab and pull to give the conversation as much room as you want. */}
          {rightOpen && !isChartFullscreen && !chatHalf && (
            <div
              onPointerDown={startResize}
              onDoubleClick={() => setChatWidth(460)}
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize the chat (double-click to reset)"
              className={`hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center border-l border-border/50 bg-card/60 hover:bg-accent transition ${resizing ? "bg-accent" : ""}`}
            >
              <span className="h-10 w-0.5 rounded-full bg-border" />
            </div>
          )}

          <aside
            aria-hidden={!(rightOpen && !isChartFullscreen)}
            style={chatHalf ? undefined : { width: chatWidth }}
            className={`hidden h-full min-h-0 max-h-full overflow-hidden border-l border-border/50 bg-background ${
              rightOpen && !isChartFullscreen ? "lg:flex lg:flex-col" : ""
            } ${
              chatHalf
                ? "w-full flex-1 min-w-0"
                : "shrink-0"
            } lg:[&_p]:text-[15px] lg:[&_p]:leading-7 lg:[&_li]:text-[15px]`}
          >
            {/* Header: tabs row, then a quiet meta row for width + model */}
            <div className="border-b border-border/50">
              <div className={`grid min-w-0 items-center gap-2 px-3 py-2.5 ${
                narrowPanel && !chatHalf
                  ? "grid-cols-[minmax(0,1fr)_auto_auto]"
                  : "grid-cols-[minmax(0,1fr)_auto_auto]"
              }`}>
                <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                  <button
                    onClick={() => setRightTab("analysis")}
                    className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      rightTab === "analysis" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <BarChart3 className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Analysis</span>
                  </button>
                  <button
                    onClick={() => { setRightTab("chat"); setChatPanelView("conversation"); }}
                    className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                      rightTab === "chat" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Chat</span>
                  </button>
                </div>

                <button
                  onClick={() => setLayout((m) => (m === "chat" ? "split" : "chat"))}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition shrink-0"
                  title={chatHalf ? "Restore chart" : "Maximize chat (minimize chart)"}
                  aria-label={chatHalf ? "Restore chart" : "Maximize chat"}
                >
                  {chatHalf ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => { setRightOpen(false); setLayout("chart"); }}
                  className="h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition shrink-0"
                  title="Minimize chat"
                  aria-label="Minimize chat"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>



            <div className="flex-1 min-h-0 overflow-hidden relative">
            <div className={`absolute inset-0 overflow-y-auto ${rightTab === "analysis" ? "" : "hidden"}`}>
              <div className="p-5">
                <PageInstructions path="/dashboard" className="mb-4" />
                <ScanBody
                  result={result}
                  scanning={scanning}
                  symbol={symbol}
                  intervalLabel={intervalLabel}
                  interval={interval}
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
                    runPlan({ data: { ticker: symbol.ticker, interval, lensDesc: `${lens.name}: ${lens.promptEmphasis}`, strategyDesc: activeStrategyDesc(), strategyId: readActiveStrategy() ?? undefined, coach: readActiveCoach() } })
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
                  <div className="shrink-0 flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
                    <button
                      onClick={startNewChat}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-3.5 py-1.5 text-xs font-semibold hover:bg-accent transition"
                    >
                      New
                    </button>
                    <button
                      onClick={() => setChatPanelView("history")}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                        chatPanelView === "history" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" /> History
                    </button>
                  </div>
                  {/* The conversation stays mounted while History is open so
                      switching back never loses the latest reply. */}
                  <div className={chatPanelView === "conversation" ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}>


                      <DashboardChatPanel
                        ref={isDesktop ? chatRef : null}
                        onRunScan={() => runScan("chat")}

                        onStopScan={() => { voice.stop(); setScanning(false); }}
                        scanning={scanning}
                        threadIdOverride={activeThreadId}
                        onAnnotations={handleChatAnnotations}
                        onShowMe={handleShowMe}
                        onGrade={handleChatGrade}
                        onConcept={setAiConcept}
                        chart={{
                          ticker: symbolLabel(symbol),
                          intervalLabel,
                          tvSymbol: symbol.tv,
                          interval,
                          enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
                          snapshot: snapshot ?? undefined,
                        }}
                      />
                  </div>
                  {chatPanelView === "history" && (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <ChatHistoryList
                        activeThreadId={activeThreadId}
                        currentTitle={historyInstrumentTitle(symbol)}
                        onPick={(id, sym) => { const s = findSymbolFromTag(sym); if (s) { threadSymbolRef.current = s.ticker; setSymbol(s); } setActiveThreadId(id); setChatPanelView("conversation"); }}
                        onNew={(id) => { setActiveThreadId(id); setChatPanelView("conversation"); }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>


      </div>

      {/* Mobile panel: Analysis / Chat. Only visible when the mobile view
          switcher is on Scan or Chat, and expands to fill the remaining height so it
          isn't squished under the chart. */}
      <div className={`overflow-hidden bg-card lg:hidden ${mobileView === "chart" ? "hidden" : "flex min-h-0 flex-1 flex-col"}`} data-tour="scan">
        <div className="shrink-0 flex items-center gap-0.5 border-b border-border/60 px-2 py-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setRightTab("analysis")}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              rightTab === "analysis" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" /> Analysis
          </button>
          <button
            onClick={() => { setRightTab("chat"); setChatPanelView("conversation"); }}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              rightTab === "chat" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
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
              interval={interval}
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
                runPlan({ data: { ticker: symbol.ticker, interval, lensDesc: `${lens.name}: ${lens.promptEmphasis}`, strategyDesc: activeStrategyDesc(), strategyId: readActiveStrategy() ?? undefined, coach: readActiveCoach() } })
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
            <div className="shrink-0 flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
              <button
                onClick={startNewChat}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-3.5 py-1.5 text-xs font-semibold hover:bg-accent transition"
              >
                New
              </button>
              <button
                onClick={() => setChatPanelView("history")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  chatPanelView === "history" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
              >
                <Clock className="h-3.5 w-3.5" /> History
              </button>
            </div>
            <div className={chatPanelView === "conversation" ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}>


                <DashboardChatPanel
                  ref={!isDesktop ? chatRef : null}
                  onRunScan={() => runScan("chat")}
                  onStopScan={() => { voice.stop(); setScanning(false); }}
                  scanning={scanning}
                  threadIdOverride={activeThreadId}
                  onAnnotations={handleChatAnnotations}
                  onShowMe={handleShowMe}
                  onGrade={handleChatGrade}
                  onConcept={setAiConcept}
                  chart={{
                    ticker: symbolLabel(symbol),
                    intervalLabel,
                    tvSymbol: symbol.tv,
                    interval,
                    enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
                    snapshot: snapshot ?? undefined,
                  }}
                />
            </div>
            {chatPanelView === "history" && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ChatHistoryList
                  activeThreadId={activeThreadId}
                  currentTitle={historyInstrumentTitle(symbol)}
                  onPick={(id, sym) => { const s = findSymbolFromTag(sym); if (s) { threadSymbolRef.current = s.ticker; setSymbol(s); } setActiveThreadId(id); setChatPanelView("conversation"); }}
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
  result, scanning, symbol, intervalLabel, interval, lensId, runScan, onAttach, onStopScan, onStopVoice, voiceSpeaking,
}: {
  result: ScanResult | null;
  scanning: boolean;
  symbol: Symbol;
  intervalLabel: string;
  interval: string;
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
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
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
        <ActionLoader label={`Scanning ${symbol.ticker}`} hint="Reading structure, sweeps, BOS, retests." />
        <button
          onClick={onStopScan}
          className="mt-1 inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/15 transition"
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
      interval={interval}
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
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/95 backdrop-blur px-3 py-2 shadow-xl hover:bg-card transition"
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
      if (activeThreadId === id) {
        clearLastThreadId(id);
        onNew(null);
      }
    } catch { toast.error("Could not delete conversation"); }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Chat history</div>
        <button
          onClick={handleNew}
          className="inline-flex items-center gap-1 rounded-xl border border-border/60 bg-background px-2 py-1 text-[11px] font-medium hover:border-primary/50 transition"
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
              className={`group flex items-start gap-2 rounded-xl px-2 py-2 text-sm cursor-pointer transition ${
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

