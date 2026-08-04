// Strategy performance loop UI: measure a playbook's historical edge and keep it
// on record so the scanner grades against real results, not assumptions.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Loader2, LineChart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BACKTEST_SYMBOLS, BACKTEST_TIMEFRAMES, TIMEFRAME_LABEL, type BacktestTimeframe } from "@/lib/backtest/catalog";
import { listStrategyPerformance, recordStrategyBacktest, type StrategyPerfRow } from "@/lib/strategy-perf.functions";
import { readActiveStrategy } from "@/lib/chat-client";
import { edgeVerdict } from "@/lib/strategy-perf.shared";

const VERDICT_COPY: Record<string, string> = {
  untested: "Untested",
  thin: "Too few trades to trust",
  positive: "Positive expectancy",
  negative: "Negative expectancy",
};

export default function StrategyEdgePanel() {
  const list = useServerFn(listStrategyPerformance);
  const record = useServerFn(recordStrategyBacktest);
  const [rows, setRows] = useState<StrategyPerfRow[]>([]);
  const [strategy, setStrategy] = useState<string | null>(null);
  const [symbol, setSymbol] = useState<string>("XAU/USD");
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>("60");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStrategy(readActiveStrategy());
    list().then(setRows).catch(() => setRows([]));
  }, [list]);

  const measure = async () => {
    if (!strategy) {
      toast.error("Pick an active strategy first on the Strategies page.");
      return;
    }
    setBusy(true);
    try {
      const res = await record({ data: { strategyId: strategy, symbol, timeframe, lookback: "2y" } });
      if (res.ok) {
        toast.success(`${strategy} measured on ${symbol}: ${res.row.trades} trades, ${res.row.expectancyR}R expectancy`);
        setRows(await list());
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <LineChart className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-medium">Strategy edge on record</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Measure your active playbook over past price history. Saved results are read by the scanner: a playbook with
            negative expectancy on an instrument gets its grade capped, one with a proven edge keeps its grade.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Active strategy</Label>
          <div className="rounded-md border border-border px-3 py-2 text-sm">
            {strategy ?? "None selected"}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Instrument</Label>
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BACKTEST_SYMBOLS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Timeframe</Label>
          <Select value={timeframe} onValueChange={(v) => setTimeframe(v as BacktestTimeframe)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BACKTEST_TIMEFRAMES.map((t) => <SelectItem key={t} value={t}>{TIMEFRAME_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <motion.div whileTap={{ scale: 0.98 }} className="mt-3 inline-block">
        <Button onClick={measure} disabled={busy} size="sm">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Measure and save edge
        </Button>
      </motion.div>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 text-left font-normal">Strategy</th>
                <th className="py-2 text-left font-normal">Instrument</th>
                <th className="py-2 text-left font-normal">TF</th>
                <th className="py-2 text-right font-normal">Trades</th>
                <th className="py-2 text-right font-normal">Win rate</th>
                <th className="py-2 text-right font-normal">Expectancy</th>
                <th className="py-2 text-right font-normal">Net R</th>
                <th className="py-2 text-left font-normal">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.strategyId}-${r.symbol}-${r.timeframe}`} className="border-b border-border/50">
                  <td className="py-2">{r.strategyId}</td>
                  <td className="py-2">{r.symbol}</td>
                  <td className="py-2">{r.timeframe}</td>
                  <td className="py-2 text-right">{r.trades}</td>
                  <td className="py-2 text-right">{r.winRate}%</td>
                  <td className="py-2 text-right">{r.expectancyR}R</td>
                  <td className="py-2 text-right">{r.netR}R</td>
                  <td className="py-2">{VERDICT_COPY[edgeVerdict(r)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
