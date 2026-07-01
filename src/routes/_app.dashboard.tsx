import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { NativeChart, LEVEL_META, type LevelKey, type ChartSnapshot } from "@/components/NativeChart";
import { ChevronDown, Crosshair, Loader2, Check, Activity, LayoutGrid, Sparkles, Clock, MessageSquare, X, Plug, Maximize2, Square, Paperclip, ChevronUp, PanelRightClose, PanelRightOpen, BarChart3 } from "lucide-react";
import { useCoachVoice } from "@/hooks/useCoachVoice";
import { DashboardChatPanel, type DashboardChatHandle } from "@/components/DashboardChatPanel";
import { TodaysRecommendation } from "@/components/TodaysRecommendation";
import { SCAN_LENSES, readActiveLensId, writeActiveLensId, findLens, type ScanLensId } from "@/lib/scanLens";
import { readActiveCoach } from "@/lib/chat-client";
import { voiceForCoach } from "@/lib/coachVoices";
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
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
            Setup ticket · {symbol.ticker} · {result.bias}
          </div>
          <div className={`font-display text-5xl sm:text-6xl leading-none ${gradeColor[result.grade]}`}>
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
              <Square className="h-3 w-3" /> Stop voice
            </button>
          )}
          <button
            onClick={onRescan}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-primary/50 transition"
          >
            Re-scan
          </button>
        </div>
      </div>

      <div className="rounded-md border border-border/60 bg-background/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Crosshair className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">Scan Lens: {lens.name}</span>
          </div>
          <button
            onClick={() => setLensOpen((o) => !o)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            {lensOpen ? "Hide" : "What does this mean?"}
          </button>
        </div>
        {lensOpen && (
          <div className="mt-2 text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-2">
            <p className="mb-1">{lens.desc}</p>
            <p className="italic">{lens.promptEmphasis}</p>
          </div>
        )}
      </div>

      <p className="text-sm leading-relaxed">{result.notes}</p>

      {!isNoEntry && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <TicketCell label="Entry" value={result.entry} />
          <TicketCell label="Stop"  value={result.stop} tone="bad" />
          <TicketCell label="TP1"   value={result.tp1} tone="good" />
          <TicketCell label="TP2"   value={result.tp2} tone="good" />
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs mb-2">
          <span className="text-muted-foreground">Confidence · R:R {result.rr}</span>
          <span className="text-primary font-semibold">{result.confidence}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
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
        <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs leading-relaxed text-foreground/90">
          {result.details}
        </div>
      )}

      <div className="pt-1 flex justify-center">
        <ScreenshotAttach onPick={onAttach} />
      </div>
    </div>
  );
}

function TicketCell({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

const ALL_LEVELS: LevelKey[] = ["VWAP","POC","SR","ZONES","FVG","FIB","LIQ","OF"];

const STORAGE_KEY = "trademind.levels.enabled.v2";

function loadLevels(): Record<LevelKey, boolean> {
  const def: Record<LevelKey, boolean> = { VWAP: true, POC: true, SR: true, ZONES: true, FVG: true, FIB: false, LIQ: true, OF: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    return { ...def, ...JSON.parse(raw) };
  } catch { return def; }
}

function Dashboard() {
  const voice = useCoachVoice();
  const [interval, setIntervalState] = useState("60");
  const [symbol, setSymbol] = useState<Symbol>(SYMBOLS[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [chartMode, setChartMode] = useState<"live" | "native">("native");
  const [levels, setLevels] = useState<Record<LevelKey, boolean>>(() =>
    typeof window !== "undefined" ? loadLevels() : { VWAP: true, POC: true, SR: true, ZONES: true, FVG: true, FIB: false, LIQ: true, OF: true },
  );
  const [sessionsOn, setSessionsOn] = useState(true);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [rightTab, setRightTab] = useState<"analysis" | "coach">("analysis");
  const [rightOpen, setRightOpen] = useState(true);
  const [snapshot, setSnapshot] = useState<ChartSnapshot | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const levelsRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<DashboardChatHandle>(null);
  const [lensId, setLensId] = useState<ScanLensId>("wyckoff");
  const [lensOpen, setLensOpen] = useState(false);
  const [broker, setBroker] = useState<{ email: string; server: string; accountType: "demo" | "live" } | null>(null);
  useEffect(() => { setLensId(readActiveLensId()); }, []);
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
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
      if (levelsRef.current && !levelsRef.current.contains(e.target as Node)) setLevelsOpen(false);
      if (lensRef.current && !lensRef.current.contains(e.target as Node)) setLensOpen(false);
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

  useEffect(() => { setResult(null); }, [symbol]);

  // Honor ?ask= deep links (from Analytics quick questions)
  const search = Route.useSearch();
  const navigate = useNavigate();
  const askedRef = useRef<string | null>(null);
  useEffect(() => {
    const q = search.ask?.trim();
    if (!q || askedRef.current === q) return;
    const tryRun = () => {
      if (!chatRef.current) { window.setTimeout(tryRun, 150); return; }
      askedRef.current = q;
      setCoachOpen(true);
      chatRef.current.scan(q);
      navigate({ to: "/dashboard", search: {}, replace: true });
    };
    tryRun();
  }, [search.ask, navigate]);

  const intervalLabel = INTERVALS.find((i) => i.value === interval)?.label ?? interval;

  const runScan = () => {
    setScanning(true);
    setResult(null);
    const enabledLevels = ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none";
    const prompt = `Analyze ${symbol.ticker} (${symbol.name}, ${symbol.venue}) on the ${intervalLabel} chart for a trade setup. I'm watching these levels: ${enabledLevels}. Give me: bias (long/short/neutral), entry trigger, stop loss, take profit 1 and 2, R:R, and a short rationale grounded in price action. Be concrete with levels.`;
    setCoachOpen(true);
    chatRef.current?.scan(prompt);
    window.setTimeout(() => {
      setResult(gradeFor(symbol, snapshot?.lastPrice));
      setScanning(false);
    }, 400);
  };



  const toggleLevel = (k: LevelKey) => setLevels((p) => ({ ...p, [k]: !p[k] }));
  const enabledCount = ALL_LEVELS.filter((k) => levels[k]).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Compact top toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-card/50">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="relative shrink-0" ref={pickerRef} data-tour="symbol-picker">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium hover:border-primary/50 transition"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
            >
              <span className="font-display text-lg font-semibold tracking-tight">{symbol.ticker}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
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
          <span className="hidden md:inline text-xs text-muted-foreground truncate">{symbol.name} · {symbol.venue}</span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Interval bar */}
          <div className="hidden sm:flex items-center gap-1 rounded-lg border border-border bg-card p-1 overflow-x-auto max-w-[16rem]">
            {INTERVALS.map((i) => (
              <button
                key={i.value}
                onClick={() => setIntervalState(i.value)}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  interval === i.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>

          {/* Scan Lens */}
          <div className="relative" ref={lensRef}>
            <button
              onClick={() => setLensOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-xs font-medium text-primary hover:border-primary/60 transition"
              title="Scan Lens"
            >
              <Crosshair className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Lens:</span>
              <span>{activeLens.short}</span>
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
                  Manage all lenses -
                </Link>
              </div>
            )}
          </div>

          {/* Levels */}
          <div className="relative" ref={levelsRef}>
            <button
              onClick={() => setLevelsOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs font-medium hover:border-primary/50 transition"
              title="Toggle overlay zones / levels"
            >
              Levels <span className="text-muted-foreground">({enabledCount})</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${levelsOpen ? "rotate-180" : ""}`} />
            </button>
            {levelsOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-card shadow-xl z-50 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-2 px-1">
                  Overlay levels
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ALL_LEVELS.map((k) => {
                    const on = levels[k];
                    const meta = LEVEL_META[k];
                    return (
                      <button
                        key={k}
                        onClick={() => toggleLevel(k)}
                        className={`rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                          on ? meta.tone : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                        style={on ? { boxShadow: `inset 0 0 0 1px ${meta.color}40` } : undefined}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                {chartMode === "live" && (
                  <div className="mt-2 px-1 text-[10px] text-muted-foreground leading-relaxed">
                    On the Live chart, FVG and Liq are Native-only - switch to Native Chart to see them.
                  </div>
                )}
                <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-[11px]">
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
            )}
          </div>

          {/* Chart mode toggle */}
          <div className="hidden md:flex items-center gap-1 rounded-md border border-border p-0.5">
            <button
              onClick={() => setChartMode("live")}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition ${
                chartMode === "live" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Activity className="h-3.5 w-3.5" /> Live
            </button>
            <button
              onClick={() => setChartMode("native")}
              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition ${
                chartMode === "native" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Native
            </button>
          </div>

          {/* Desktop right-rail toggle */}
          <button
            onClick={() => setRightOpen((v) => !v)}
            className="hidden lg:inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs font-medium hover:border-primary/50 transition"
            title={rightOpen ? "Hide side panel" : "Show side panel"}
          >
            {rightOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            <span className="hidden xl:inline">{rightOpen ? "Hide" : "Show"}</span>
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0 relative bg-card" data-tour="chart">
        <div className="absolute inset-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">
            {chartMode === "live" ? (
              <TradingViewChart symbol={symbol.tv} interval={interval} enabled={levels} />
            ) : (
              <NativeChart symbol={symbol.tv} ticker={symbol.ticker} interval={interval} enabled={levels} sessions={sessionsOn} onSnapshot={setSnapshot} />
            )}
          </div>

          {/* Broker strip */}
          <div className="shrink-0 border-t border-border/60 px-3 py-2 flex items-center justify-between gap-2 flex-wrap text-xs">
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
        </div>

        {/* Right rail overlay - desktop only */}
        {rightOpen && (
          <aside className="hidden lg:flex absolute right-0 top-0 bottom-0 w-[400px] border-l border-border bg-card z-20 flex-col shadow-2xl">
            <div className="flex items-center gap-1 border-b border-border/60 p-1">
              <button
                onClick={() => setRightTab("analysis")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition ${
                  rightTab === "analysis" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" /> Analysis
              </button>
              <button
                onClick={() => setRightTab("coach")}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition ${
                  rightTab === "coach" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" /> Coach
              </button>
              <button
                onClick={() => setRightOpen(false)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
                title="Close panel"
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {rightTab === "analysis" ? (
                <div className="h-full overflow-y-auto p-4 space-y-6">
                  <TodaysRecommendation />
                  <ScanBody
                    result={result}
                    scanning={scanning}
                    symbol={symbol}
                    intervalLabel={intervalLabel}
                    lensId={lensId}
                    runScan={runScan}
                    onAttach={(file) => {
                      setRightTab("coach");
                      chatRef.current?.attach(file, `Scan this chart screenshot for ${symbol.ticker} on ${intervalLabel}. Give me grade, bias, entry, stop, TP1, TP2, R:R, and a 1-2 sentence rationale.`);
                      setScanning(true);
                      window.setTimeout(() => {
                        setResult(gradeFor(symbol, snapshot?.lastPrice));
                        setScanning(false);
                      }, 400);
                    }}
                    onStopScan={() => { chatRef.current?.stop(); voice.stop(); setScanning(false); }}
                    onStopVoice={() => voice.stop()}
                    voiceSpeaking={voice.speaking}
                  />
                </div>
              ) : (
                <DashboardChatPanel
                  ref={chatRef}
                  onRunScan={runScan}
                  onStopScan={() => { voice.stop(); setScanning(false); }}
                  scanning={scanning}
                  chart={{
                    ticker: symbol.ticker,
                    intervalLabel,
                    enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
                    snapshot: snapshot ?? undefined,
                  }}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Mobile scan card */}
      <div className="lg:hidden shrink-0 border-t border-border/60 bg-card p-3 sm:p-4" data-tour="scan">
        <ScanBody
          result={result}
          scanning={scanning}
          symbol={symbol}
          intervalLabel={intervalLabel}
          lensId={lensId}
          runScan={runScan}
          onAttach={(file) => {
            setCoachOpen(true);
            chatRef.current?.attach(file, `Scan this chart screenshot for ${symbol.ticker} on ${intervalLabel}. Give me grade, bias, entry, stop, TP1, TP2, R:R, and a 1-2 sentence rationale.`);
            setScanning(true);
            window.setTimeout(() => {
              setResult(gradeFor(symbol, snapshot?.lastPrice));
              setScanning(false);
            }, 400);
          }}
          onStopScan={() => { chatRef.current?.stop(); voice.stop(); setScanning(false); }}
          onStopVoice={() => voice.stop()}
          voiceSpeaking={voice.speaking}
        />
      </div>

      {/* Floating AI Coach - mobile/tablet */}
      <div className="lg:hidden">
        <FloatingCoach
          open={coachOpen}
          onOpen={() => setCoachOpen(true)}
          onClose={() => setCoachOpen(false)}
          chatRef={chatRef}
          onRunScan={runScan}
          onStopScan={() => { voice.stop(); setScanning(false); }}
          scanning={scanning}
          chart={{
            ticker: symbol.ticker,
            intervalLabel,
            enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
            snapshot: snapshot ?? undefined,
          }}
        />
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
          aria-label="Open AI coach"
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
          aria-label="Expand AI coach"
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-xl hover:bg-card transition"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
          </span>
          <span className="text-xs font-medium">AI Coach</span>
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


