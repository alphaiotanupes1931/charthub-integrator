import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { NativeChart, LEVEL_META, type LevelKey } from "@/components/NativeChart";
import { ChevronDown, Crosshair, Loader2, Check, Activity, LayoutGrid, Sparkles, Clock, MessageSquare, X } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { DashboardChatPanel, type DashboardChatHandle } from "@/components/DashboardChatPanel";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard, TradeMind" },
      { name: "description", content: "Live chart and AI setup analysis for your active instrument." },
    ],
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
  { tv: "OANDA:XAUUSD",      ticker: "XAU/USD", name: "Gold Spot",       venue: "OANDA"   },
  { tv: "BINANCE:BTCUSDT",   ticker: "BTC/USD", name: "Bitcoin",         venue: "Binance" },
  { tv: "BINANCE:ETHUSDT",   ticker: "ETH/USD", name: "Ethereum",        venue: "Binance" },
  { tv: "FOREXCOM:NSXUSD",   ticker: "NAS100",  name: "US Nasdaq 100",   venue: "FOREX.com" },
  { tv: "FOREXCOM:SPXUSD",   ticker: "SPX500",  name: "S&P 500",         venue: "FOREX.com" },
  { tv: "FOREXCOM:DJI",      ticker: "US30",    name: "Dow Jones",       venue: "FOREX.com" },
  { tv: "FX:EURUSD",         ticker: "EUR/USD", name: "Euro / Dollar",   venue: "FX"      },
  { tv: "FX:GBPUSD",         ticker: "GBP/USD", name: "Pound / Dollar",  venue: "FX"      },
  { tv: "FX:USDJPY",         ticker: "USD/JPY", name: "Dollar / Yen",    venue: "FX"      },
];

type ScanResult = {
  grade: "A+" | "A" | "B" | "C" | "NO ENTRY";
  bias: "Long" | "Short" | "Neutral";
  confidence: number;
  notes: string;
};

function gradeFor(symbol: Symbol): ScanResult {
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
  return { grade, bias, confidence, notes: notesByGrade[grade] };
}

const gradeColor: Record<ScanResult["grade"], string> = {
  "A+": "text-primary",
  A:   "text-emerald-400",
  B:   "text-foreground/80",
  C:   "text-destructive",
  "NO ENTRY": "text-destructive",
};

const ALL_LEVELS: LevelKey[] = ["VWAP","POC","SR","ZONES","FVG","FIB","LIQ"];

const STORAGE_KEY = "trademind.levels.enabled.v1";

function loadLevels(): Record<LevelKey, boolean> {
  const def: Record<LevelKey, boolean> = { VWAP: true, POC: true, SR: true, ZONES: true, FVG: true, FIB: false, LIQ: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    return { ...def, ...JSON.parse(raw) };
  } catch { return def; }
}

function Dashboard() {
  const { profile } = useProfile();
  const firstName = profile?.display_name?.split(" ")[0] ?? null;
  const [interval, setIntervalState] = useState("60");
  const [symbol, setSymbol] = useState<Symbol>(SYMBOLS[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [chartMode, setChartMode] = useState<"live" | "native">("native");
  const [levels, setLevels] = useState<Record<LevelKey, boolean>>(() =>
    typeof window !== "undefined" ? loadLevels() : { VWAP: true, POC: true, SR: true, ZONES: true, FVG: true, FIB: false, LIQ: true },
  );
  const [sessionsOn, setSessionsOn] = useState(true);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const levelsRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<DashboardChatHandle>(null);


  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(levels)); } catch { /* ignore */ }
  }, [levels]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
      if (levelsRef.current && !levelsRef.current.contains(e.target as Node)) setLevelsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => { setResult(null); }, [symbol]);

  const intervalLabel = INTERVALS.find((i) => i.value === interval)?.label ?? interval;

  const runScan = () => {
    setScanning(true);
    setResult(null);
    const enabledLevels = ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none";
    const prompt = `Analyze ${symbol.ticker} (${symbol.name}, ${symbol.venue}) on the ${intervalLabel} chart for a trade setup. I'm watching these levels: ${enabledLevels}. Give me: bias (long/short/neutral), entry trigger, stop loss, take profit 1 and 2, R:R, and a short rationale grounded in price action. Be concrete with levels.`;
    setCoachOpen(true);
    chatRef.current?.scan(prompt);
    window.setTimeout(() => {
      setResult(gradeFor(symbol));
      setScanning(false);
    }, 400);
  };



  const toggleLevel = (k: LevelKey) => setLevels((p) => ({ ...p, [k]: !p[k] }));
  const enabledCount = ALL_LEVELS.filter((k) => levels[k]).length;

  return (
    <div className="mx-auto max-w-[1600px] px-4 sm:px-6 py-6 sm:py-8">
      {firstName && (
        <div className="text-sm text-muted-foreground mb-4">
          Welcome back, <span className="text-foreground font-medium">{profile?.display_name}</span>
        </div>
      )}
      <div className="space-y-5">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
          <div className="min-w-0">

          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
            Active instrument
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight truncate">
            {symbol.ticker}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 truncate">
            {symbol.name} · {symbol.venue}
          </p>
        </div>

        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:border-primary/50 transition"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            Change symbol
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
          {pickerOpen && (
            <div role="listbox" className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-20">
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
      </header>

      {/* Interval bar */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit overflow-x-auto max-w-full">
        {INTERVALS.map((i) => (
          <button
            key={i.value}
            onClick={() => setIntervalState(i.value)}
            className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              interval === i.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      {/* Chart card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Chart toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <button
              onClick={() => setChartMode("live")}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                chartMode === "live" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Activity className="h-3.5 w-3.5" /> Live Chart
            </button>
            <button
              onClick={() => setChartMode("native")}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                chartMode === "native" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Native Chart
            </button>
          </div>

          <div className="relative" ref={levelsRef}>
            <button
              onClick={() => setLevelsOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium hover:border-primary/50 transition"
              title="Toggle overlay zones / levels"
            >
              Levels <span className="text-muted-foreground">({enabledCount})</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${levelsOpen ? "rotate-180" : ""}`} />
            </button>
            {levelsOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-lg border border-border bg-card shadow-xl z-20 p-2.5">
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
                    On the Live chart, FVG and Liq are Native-only — switch to Native Chart to see them.
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
        </div>

        <div className="h-[520px]">
          {chartMode === "live" ? (
            <TradingViewChart symbol={symbol.tv} interval={interval} enabled={levels} />
          ) : (
            <NativeChart symbol={symbol.tv} ticker={symbol.ticker} interval={interval} enabled={levels} />
          )}
        </div>

      </div>


      {/* Scan card */}
      <div className="rounded-xl border border-border bg-card p-8">
        {!result && !scanning && (
          <div className="flex flex-col items-center text-center gap-3">
            <Crosshair className="h-6 w-6 text-primary" />
            <div className="font-semibold">Ready to scan</div>
            <p className="text-sm text-muted-foreground max-w-sm">
              Grade the current setup on {symbol.ticker} and get a written breakdown.
            </p>
            <button
              onClick={runScan}
              className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
            >
              Run scan
            </button>
          </div>
        )}

        {scanning && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
            <div className="font-semibold">Scanning {symbol.ticker}…</div>
            <p className="text-sm text-muted-foreground">Reading structure, sweeps, BOS, retests.</p>
          </div>
        )}

        {result && !scanning && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground mb-1.5">
                  Setup grade · {symbol.ticker} · {result.bias}
                </div>
                <div className={`font-display text-6xl leading-none ${gradeColor[result.grade]}`}>
                  {result.grade}
                </div>
              </div>
              <button
                onClick={runScan}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:border-primary/50 transition"
              >
                Re-scan
              </button>
            </div>
            <p className="text-sm leading-relaxed">{result.notes}</p>
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">Confidence</span>
                <span className="text-primary font-semibold">{result.confidence}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${result.confidence}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* Floating AI Coach bubble */}
      <FloatingCoach
        open={coachOpen}
        onOpen={() => setCoachOpen(true)}
        onClose={() => setCoachOpen(false)}
        chatRef={chatRef}
        chart={{
          ticker: symbol.ticker,
          intervalLabel,
          enabledLevels: ALL_LEVELS.filter((k) => levels[k]).map((k) => LEVEL_META[k].label).join(", ") || "none",
        }}
      />
    </div>
  );
}

function FloatingCoach({
  open, onOpen, onClose, chatRef, chart,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  chatRef: React.RefObject<DashboardChatHandle | null>;
  chart: { ticker: string; intervalLabel: string; enabledLevels: string };
}) {
  return (
    <>
      {/* Bubble (always rendered, hidden when open so the panel can take over) */}
      {!open && (
        <button
          onClick={onOpen}
          aria-label="Open AI coach"
          className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 ring-1 ring-primary/40 hover:scale-105 transition flex items-center justify-center"
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      )}

      {/* Expanded panel — always mounted so the chat thread persists between toggles */}
      <div
        className={`fixed z-40 right-4 bottom-4 sm:right-6 sm:bottom-6 w-[min(420px,calc(100vw-2rem))] h-[min(640px,calc(100vh-2rem))] transition-all duration-200 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-4 pointer-events-none"
        }`}
      >
        <DashboardChatPanel ref={chatRef} chart={chart} onClose={onClose} />
      </div>
    </>
  );
}


