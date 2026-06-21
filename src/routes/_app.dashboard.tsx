import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { ChevronDown, Crosshair, Loader2, Check } from "lucide-react";

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
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1H", value: "60" },
  { label: "4H", value: "240" },
  { label: "1D", value: "D" },
];

type Symbol = {
  tv: string;
  ticker: string;
  name: string;
  venue: string;
};

const SYMBOLS: Symbol[] = [
  { tv: "OANDA:XAUUSD", ticker: "XAU/USD", name: "Gold Spot", venue: "OANDA" },
  { tv: "BINANCE:BTCUSDT", ticker: "BTC/USD", name: "Bitcoin", venue: "Binance" },
  { tv: "BINANCE:ETHUSDT", ticker: "ETH/USD", name: "Ethereum", venue: "Binance" },
  { tv: "FOREXCOM:NSXUSD", ticker: "NAS100", name: "US Nasdaq 100", venue: "FOREX.com" },
  { tv: "FOREXCOM:SPXUSD", ticker: "SPX500", name: "S&P 500", venue: "FOREX.com" },
  { tv: "FOREXCOM:DJI", ticker: "US30", name: "Dow Jones", venue: "FOREX.com" },
  { tv: "FX:EURUSD", ticker: "EUR/USD", name: "Euro / Dollar", venue: "FX" },
  { tv: "FX:GBPUSD", ticker: "GBP/USD", name: "Pound / Dollar", venue: "FX" },
  { tv: "FX:USDJPY", ticker: "USD/JPY", name: "Dollar / Yen", venue: "FX" },
];

type ScanResult = {
  grade: "A+" | "A" | "B" | "C" | "NO ENTRY";
  bias: "Long" | "Short" | "Neutral";
  confidence: number;
  notes: string;
};

function gradeFor(symbol: Symbol): ScanResult {
  // Deterministic pseudo-grade per symbol so it feels real, not random per click
  let h = 0;
  for (let i = 0; i < symbol.tv.length; i++) h = (h * 31 + symbol.tv.charCodeAt(i)) >>> 0;
  const grades: ScanResult["grade"][] = ["A+", "A", "B", "C", "NO ENTRY"];
  const grade = grades[h % grades.length];
  const bias = (["Long", "Short", "Neutral"] as const)[(h >> 4) % 3];
  const confidence = 55 + ((h >> 8) % 40);
  const notesByGrade: Record<ScanResult["grade"], string> = {
    "A+": "Sweep then BOS confirmed. Clean retest forming. Stop is structurally tight.",
    A: "Strong Phase D setup. Wait for first 5m close back inside range before entry.",
    B: "Confluence is partial. R:R only justifies a half size.",
    C: "Choppy structure. Liquidity above and below. Skip until one side resolves.",
    "NO ENTRY": "No edge. Range mid with conflicting HTF bias. Stand down.",
  };
  return { grade, bias, confidence, notes: notesByGrade[grade] };
}

const gradeColor: Record<ScanResult["grade"], string> = {
  "A+": "text-primary",
  A: "text-emerald-400",
  B: "text-foreground/80",
  C: "text-destructive",
  "NO ENTRY": "text-destructive",
};

function Dashboard() {
  const [interval, setIntervalState] = useState("60");
  const [symbol, setSymbol] = useState<Symbol>(SYMBOLS[0]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // Reset scan when symbol changes
  useEffect(() => {
    setResult(null);
  }, [symbol]);

  const runScan = () => {
    setScanning(true);
    setResult(null);
    window.setTimeout(() => {
      setResult(gradeFor(symbol));
      setScanning(false);
    }, 900);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-6">
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

        {/* Symbol picker */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:border-primary/50 transition"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            Change symbol
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${pickerOpen ? "rotate-180" : ""}`}
            />
          </button>
          {pickerOpen && (
            <div
              role="listbox"
              className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-card shadow-xl z-20"
            >
              {SYMBOLS.map((s) => {
                const active = s.tv === symbol.tv;
                return (
                  <button
                    key={s.tv}
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setSymbol(s);
                      setPickerOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-3 hover:bg-accent/40 transition ${
                      active ? "bg-primary/10 text-primary" : "text-foreground"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.ticker}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {s.name} · {s.venue}
                      </div>
                    </div>
                    {active && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      {/* Interval selector */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {INTERVALS.map((i) => (
          <button
            key={i.value}
            onClick={() => setIntervalState(i.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              interval === i.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {i.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="h-[520px]">
          <TradingViewChart symbol={symbol.tv} interval={interval} />
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
            <p className="text-sm text-muted-foreground">
              Reading structure, sweeps, BOS, retests.
            </p>
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
                <div
                  className="h-full bg-primary transition-[width] duration-500"
                  style={{ width: `${result.confidence}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
