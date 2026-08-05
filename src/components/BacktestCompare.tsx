// Comparison view: run the same rule set across several instruments and
// timeframes, then rank the results side by side so a trader can see where the
// edge actually lives instead of running one backtest at a time.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Loader2, Rows3, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { runHistoricalBacktest, type BacktestRequest } from "@/lib/backtest/backtest.functions";
import { BACKTEST_SYMBOLS, BACKTEST_TIMEFRAMES, TIMEFRAME_LABEL, type BacktestTimeframe } from "@/lib/backtest/catalog";

type Row = {
  symbol: string;
  timeframe: string;
  trades: number;
  winRate: number;
  expectancyR: number;
  netR: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
  returnPct: number;
  error?: string;
};

type Props = {
  /** Current form settings from the backtest page, reused for every run. */
  base: Omit<BacktestRequest, "symbol" | "timeframe">;
};

function downloadFile(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function BacktestCompare({ base }: Props) {
  const run = useServerFn(runHistoricalBacktest);
  const [symbols, setSymbols] = useState<string[]>(["XAU/USD", "EUR/USD", "BTC/USD"]);
  const [timeframes, setTimeframes] = useState<BacktestTimeframe[]>(["60", "240"]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const combos = symbols.length * timeframes.length;

  const compare = async () => {
    if (combos === 0 || combos > 12) return;
    setBusy(true);
    setRows([]);
    const out: Row[] = [];
    try {
      for (const symbol of symbols) {
        for (const timeframe of timeframes) {
          setProgress(`${symbol} ${TIMEFRAME_LABEL[timeframe]}`);
          try {
            const res = await run({ data: { ...base, symbol, timeframe } });
            if (res.ok) {
              const s = res.result.stats;
              out.push({
                symbol, timeframe,
                trades: s.trades, winRate: s.winRate, expectancyR: s.expectancyR,
                netR: s.netR, profitFactor: s.profitFactor,
                maxDrawdownPct: s.maxDrawdownPct, returnPct: s.returnPct,
              });
            } else {
              out.push({ symbol, timeframe, trades: 0, winRate: 0, expectancyR: 0, netR: 0, profitFactor: null, maxDrawdownPct: 0, returnPct: 0, error: res.error });
            }
          } catch (e) {
            out.push({ symbol, timeframe, trades: 0, winRate: 0, expectancyR: 0, netR: 0, profitFactor: null, maxDrawdownPct: 0, returnPct: 0, error: (e as Error).message });
          }
          setRows([...out]);
        }
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const ranked = [...rows].sort((a, b) => b.expectancyR - a.expectancyR);

  const exportCsv = () => {
    const head = "symbol,timeframe,trades,win_rate_pct,expectancy_r,net_r,profit_factor,max_drawdown_pct,return_pct,error";
    const body = ranked
      .map((r) =>
        [r.symbol, r.timeframe, r.trades, r.winRate, r.expectancyR, r.netR, r.profitFactor ?? "", r.maxDrawdownPct, r.returnPct, r.error ? `"${r.error.replace(/"/g, "'")}"` : ""].join(","),
      )
      .join("\n");
    downloadFile(`comparison-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv", `${head}\n${body}`);
  };

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Rows3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-medium">Comparison view</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Runs the settings above across every instrument and timeframe you tick, then ranks them by expectancy.
            Max 12 runs at a time.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Instruments</Label>
          <div className="flex flex-wrap gap-2">
            {BACKTEST_SYMBOLS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(symbols, s as string, setSymbols)}
                className={`rounded-md border px-2 py-1 text-xs ${symbols.includes(s) ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Timeframes</Label>
          <div className="flex flex-wrap gap-2">
            {BACKTEST_TIMEFRAMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggle(timeframes, t, setTimeframes)}
                className={`rounded-md border px-2 py-1 text-xs ${timeframes.includes(t) ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >
                {TIMEFRAME_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <motion.div whileTap={{ scale: 0.98 }} className="inline-block">
          <Button size="sm" onClick={compare} disabled={busy || combos === 0 || combos > 12}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Compare {combos > 0 ? `${combos} run${combos > 1 ? "s" : ""}` : ""}
          </Button>
        </motion.div>
        {combos > 12 && <span className="text-xs text-red-500">Too many combinations, untick some.</span>}
        {busy && progress && <span className="text-xs text-muted-foreground">Running {progress}</span>}
        {rows.length > 0 && !busy && (
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export comparison
          </Button>
        )}
      </div>

      {ranked.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 text-left font-normal">Instrument</th>
                <th className="py-2 text-left font-normal">TF</th>
                <th className="py-2 text-right font-normal">Trades</th>
                <th className="py-2 text-right font-normal">Win rate</th>
                <th className="py-2 text-right font-normal">Expectancy</th>
                <th className="py-2 text-right font-normal">Net R</th>
                <th className="py-2 text-right font-normal">Profit factor</th>
                <th className="py-2 text-right font-normal">Max DD</th>
                <th className="py-2 text-right font-normal">Return</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={`${r.symbol}-${r.timeframe}`} className="border-b border-border/50">
                  <td className="py-2">{r.symbol}</td>
                  <td className="py-2">{TIMEFRAME_LABEL[r.timeframe as BacktestTimeframe] ?? r.timeframe}</td>
                  {r.error ? (
                    <td className="py-2 text-muted-foreground" colSpan={7}>{r.error}</td>
                  ) : (
                    <>
                      <td className="py-2 text-right">{r.trades}</td>
                      <td className="py-2 text-right">{r.winRate}%</td>
                      <td className={`py-2 text-right font-semibold ${r.expectancyR > 0 ? "text-bull" : r.expectancyR < 0 ? "text-red-500" : ""}`}>
                        {r.expectancyR > 0 ? "+" : ""}{r.expectancyR}R
                      </td>
                      <td className="py-2 text-right">{r.netR > 0 ? "+" : ""}{r.netR}R</td>
                      <td className="py-2 text-right">{r.profitFactor == null ? "n/a" : r.profitFactor}</td>
                      <td className="py-2 text-right">{r.maxDrawdownPct}%</td>
                      <td className="py-2 text-right">{r.returnPct > 0 ? "+" : ""}{r.returnPct}%</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default BacktestCompare;
