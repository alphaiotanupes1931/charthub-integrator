import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { findPatterns, nameChoices, type Bias, type DrillBar, type FoundPattern } from "@/lib/pattern-drill";
import { cn } from "@/lib/utils";

const MARKETS = [
  { ticker: "XAU/USD", name: "Gold" },
  { ticker: "XAG/USD", name: "Silver" },
  { ticker: "EUR/USD", name: "EUR/USD" },
  { ticker: "GBP/USD", name: "GBP/USD" },
  { ticker: "USD/JPY", name: "USD/JPY" },
  { ticker: "NAS100", name: "Nasdaq 100" },
  { ticker: "SPX500", name: "S&P 500" },
  { ticker: "BTC/USD", name: "Bitcoin" },
  { ticker: "ETH/USD", name: "Ethereum" },
];
const TFS = [
  { v: "15", l: "15m" },
  { v: "60", l: "1H" },
  { v: "240", l: "4H" },
  { v: "D", l: "Daily" },
];

function PatternChart({ p }: { p: FoundPattern }) {
  const W = 560, H = 220, pad = 8;
  const bars = p.window;
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  const y = (v: number) => pad + ((hi - v) / Math.max(1e-12, hi - lo)) * (H - pad * 2);
  const step = W / bars.length;
  const bw = Math.max(2, step * 0.6);
  const [a, b] = p.highlight;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Pattern on the live chart">
      <rect x={a * step} y={0} width={(b - a + 1) * step} height={H} className="fill-primary/10" />
      {bars.map((bar, i) => {
        const x = i * step + step / 2;
        const green = bar.close >= bar.open;
        const cls = green ? "stroke-bull fill-bull" : "stroke-bear fill-bear";
        const top = y(Math.max(bar.open, bar.close));
        const h = Math.max(1, Math.abs(y(bar.open) - y(bar.close)));
        return (
          <g key={i} className={cls}>
            <line x1={x} x2={x} y1={y(bar.high)} y2={y(bar.low)} strokeWidth={1} />
            <rect x={x - bw / 2} y={top} width={bw} height={h} />
          </g>
        );
      })}
    </svg>
  );
}

export function PatternDrill() {
  const [ticker, setTicker] = useState(MARKETS[0].ticker);
  const [tf, setTf] = useState("60");
  const [patterns, setPatterns] = useState<FoundPattern[]>([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [namePick, setNamePick] = useState<string | null>(null);
  const [biasPick, setBiasPick] = useState<Bias | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setPatterns([]);
    setIdx(0);
    setNamePick(null);
    setBiasPick(null);
    try {
      const r = await fetch(`/api/ohlc?ticker=${encodeURIComponent(ticker)}&interval=${tf}`);
      const j = r.ok ? ((await r.json()) as { bars?: DrillBar[] }) : null;
      setPatterns(findPatterns(j?.bars));
    } catch {
      setPatterns([]);
    } finally {
      setLoading(false);
    }
  }, [ticker, tf]);

  useEffect(() => { void load(); }, [load]);

  const p = patterns[idx];
  const choices = useMemo(() => (p?.kind === "candle" ? nameChoices(p.name, idx + p.window.length) : []), [p, idx]);
  const needsName = p?.kind === "candle";
  const done = !!p && biasPick !== null;
  const allRight = done && biasPick === p.bias && (!needsName || namePick === p.name);

  const pickBias = (b: Bias) => {
    if (!p || biasPick) return;
    setBiasPick(b);
    const ok = b === p.bias && (!needsName || namePick === p.name);
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1 }));
  };
  const next = () => {
    setNamePick(null);
    setBiasPick(null);
    if (idx + 1 < patterns.length) setIdx(idx + 1);
    else void load();
  };
  const market = MARKETS.find((m) => m.ticker === ticker)?.name ?? ticker;
  const tfLabel = TFS.find((t) => t.v === tf)?.l ?? tf;

  return (
    <section className="mb-8 rounded-sm border border-border/60 bg-card p-5" data-testid="pattern-drill">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Pattern drill</h2>
          <p className="text-xs text-muted-foreground">Real patterns found on the live chart. Name it, then call it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={ticker} onChange={(e) => setTicker(e.target.value)} className="rounded-sm border border-border/60 bg-background px-2 py-1.5 text-sm" aria-label="Market">
            {MARKETS.map((m) => <option key={m.ticker} value={m.ticker}>{m.name}</option>)}
          </select>
          <div className="flex rounded-sm border border-border/60 overflow-hidden">
            {TFS.map((t) => (
              <button key={t.v} type="button" onClick={() => setTf(t.v)} className={cn("px-2.5 py-1.5 text-xs", tf === t.v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{t.l}</button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{score.right}/{score.total}</span>
        </div>
      </div>

      {loading ? (
        <p className="py-16 text-center text-xs text-muted-foreground">Scanning {market} for patterns…</p>
      ) : !p ? (
        <div className="py-12 text-center text-xs text-muted-foreground space-y-3">
          <p>No clear pattern on {market} {tfLabel} right now. Try another market or timeframe.</p>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-sm border border-border/60 px-3 py-1.5 hover:bg-muted"><RefreshCw className="h-3 w-3" />Scan again</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-[10px] tracking-[0.2em] text-muted-foreground">
            {p.kind === "candle" ? "CANDLESTICK PATTERN" : "CHART PATTERN"} · {market.toUpperCase()} · {tfLabel} · {idx + 1} OF {patterns.length}
          </div>
          <div className="rounded-sm border border-border/60 bg-background p-2"><PatternChart p={p} /></div>

          {needsName && (
            <div>
              <p className="mb-2 text-sm font-medium">1. What is the highlighted candle pattern called?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {choices.map((c) => {
                  const show = done && (c === p.name || c === namePick);
                  return (
                    <button key={c} type="button" disabled={done} onClick={() => setNamePick(c)}
                      className={cn("rounded-sm border px-3 py-2 text-left text-sm transition",
                        show && c === p.name ? "border-primary bg-primary/10" : show ? "border-destructive bg-destructive/10" : namePick === c ? "border-primary/60 bg-primary/5" : "border-border/60 hover:border-primary/60")}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {(!needsName || namePick) && (
            <div>
              <p className="mb-2 text-sm font-medium">{needsName ? "2. " : ""}Is this pattern bullish or bearish?</p>
              <div className="grid grid-cols-2 gap-2">
                {(["bullish", "bearish"] as Bias[]).map((b) => (
                  <button key={b} type="button" disabled={done} onClick={() => pickBias(b)}
                    className={cn("rounded-sm border px-3 py-3 text-sm font-medium capitalize transition",
                      done && b === p.bias ? "border-primary bg-primary/10" : done && b === biasPick ? "border-destructive bg-destructive/10" : "border-border/60 hover:border-primary/60")}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {done && (
            <div className={cn("rounded-sm border p-4", allRight ? "border-primary/50 bg-primary/[0.06]" : "border-destructive/40 bg-destructive/[0.05]")}>
              <div className={cn("mb-2 flex items-center gap-1.5 text-[10px] tracking-[0.2em]", allRight ? "text-primary" : "text-destructive")}>
                {allRight ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{allRight ? "CORRECT" : "NOT QUITE"}
              </div>
              <p className="text-base font-medium">{p.name} · <span className="capitalize">{p.bias}</span></p>
              <p className="mt-1 text-sm text-foreground/90">{p.why}</p>
              <button type="button" onClick={next} className="mt-3 rounded-sm bg-primary px-4 py-2 text-sm text-primary-foreground">Next pattern</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
