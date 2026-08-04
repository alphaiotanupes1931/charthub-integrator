import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { motion } from "framer-motion";
import { FlaskConical, Play } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { runHistoricalBacktest, type BacktestResponse } from "@/lib/backtest/backtest.functions";
import { BACKTEST_SYMBOLS, BACKTEST_TIMEFRAMES, TIMEFRAME_LABEL, type BacktestTimeframe } from "@/lib/backtest/history.server";
import type { BtBucket, BtResult } from "@/lib/backtest/engine";

export const Route = createFileRoute("/_app/backtest")({
  head: () => ({
    meta: [
      { title: "Historical Backtest, TradeMind" },
      { name: "description", content: "Replay the TradeMind signal rules over years of price history and read win rate, expectancy, drawdown and an equity curve per instrument." },
      { property: "og:title", content: "Historical Backtest, TradeMind" },
      { property: "og:description", content: "Replay the signal rules over years of price history: win rate, expectancy, drawdown and equity curve." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BacktestPage,
});

const SESSIONS = ["Asia", "London", "New York", "Late US"];

function fmtDate(sec: number): string {
  if (!sec) return "";
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "good" ? "text-bull" : tone === "bad" ? "text-red-500" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: BtBucket[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="divide-y divide-border">
        {rows.map((b) => (
          <div key={b.key} className="grid grid-cols-4 gap-2 px-3 py-2 text-xs">
            <span className="font-medium">{b.key}</span>
            <span className="text-muted-foreground">{b.trades} trades</span>
            <span className="text-muted-foreground">{b.winRate}% win</span>
            <span className={`text-right font-mono font-semibold ${b.expectancyR > 0 ? "text-bull" : b.expectancyR < 0 ? "text-red-500" : "text-muted-foreground"}`}>
              {b.expectancyR > 0 ? "+" : ""}{b.expectancyR}R
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Results({ result }: { result: BtResult }) {
  const s = result.stats;
  const curve = [{ time: result.from, balance: 10000, netR: 0 }, ...result.equity];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
    >
      <div className="rounded-md border border-border p-3 text-xs text-muted-foreground">
        {result.symbol} · {TIMEFRAME_LABEL[result.timeframe as BacktestTimeframe] ?? result.timeframe} ·{" "}
        {result.barCount} bars from {fmtDate(result.from)} to {fmtDate(result.to)} · feed {result.source}
      </div>

      {result.notes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-border p-3 text-xs text-muted-foreground">
          {result.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Trades" value={String(s.trades)} />
        <Stat label="Win rate" value={`${s.winRate}%`} />
        <Stat label="Expectancy" value={`${s.expectancyR > 0 ? "+" : ""}${s.expectancyR}R`} tone={s.expectancyR > 0 ? "good" : s.expectancyR < 0 ? "bad" : undefined} />
        <Stat label="Net" value={`${s.netR > 0 ? "+" : ""}${s.netR}R`} tone={s.netR > 0 ? "good" : s.netR < 0 ? "bad" : undefined} />
        <Stat label="Profit factor" value={s.profitFactor == null ? "n/a" : String(s.profitFactor)} />
        <Stat label="Max drawdown" value={`${s.maxDrawdownPct}%`} tone={s.maxDrawdownPct > 20 ? "bad" : undefined} />
        <Stat label="Return on 10k" value={`${s.returnPct > 0 ? "+" : ""}${s.returnPct}%`} tone={s.returnPct > 0 ? "good" : s.returnPct < 0 ? "bad" : undefined} />
        <Stat label="Buy and hold" value={`${s.benchmarkPct > 0 ? "+" : ""}${s.benchmarkPct}%`} />
        <Stat label="Avg win" value={`+${s.avgWinR}R`} />
        <Stat label="Avg loss" value={`${s.avgLossR}R`} />
        <Stat label="Worst losing streak" value={String(s.maxConsecutiveLosses)} />
        <Stat label="Avg hold" value={`${s.avgHoldBars} bars`} />
      </div>

      {result.equity.length > 1 && (
        <div className="rounded-md border border-border p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Equity curve, {result.params.riskPct}% risk per trade
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={curve}>
                <CartesianGrid strokeDasharray="2 2" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tickFormatter={fmtDate} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} domain={["auto", "auto"]} />
                <Tooltip
                  labelFormatter={(v) => fmtDate(Number(v))}
                  formatter={(v: number) => [`$${v.toLocaleString()}`, "Balance"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                />
                <Area type="monotone" dataKey="balance" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <BucketTable title="By grade" rows={result.byGrade} />
        <BucketTable title="By direction" rows={result.bySide} />
        <BucketTable title="By session (UTC)" rows={result.bySession} />
        <BucketTable title="By month" rows={result.byMonth} />
      </div>

      {result.trades.length > 0 && (
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Trade log ({result.trades.length})
          </div>
          <div className="max-h-96 overflow-auto divide-y divide-border">
            {result.trades.map((t) => (
              <div key={t.id} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-muted-foreground">{fmtDate(t.entryTime)}</span>
                  <span className="font-semibold">{t.side}</span>
                  <span className="rounded border border-border px-1">{t.grade}</span>
                  <span className="text-muted-foreground">{t.session}</span>
                  <span className="font-mono text-muted-foreground">
                    in {t.entry} · stop {t.stop} · target {t.target} · out {t.exit}
                  </span>
                  <span className={`ml-auto font-mono font-semibold ${t.r > 0 ? "text-bull" : "text-red-500"}`}>
                    {t.r > 0 ? "+" : ""}{t.r}R
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">{t.reasons.join(" · ")}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function BacktestPage() {
  const run = useServerFn(runHistoricalBacktest);
  const [symbol, setSymbol] = useState("XAU/USD");
  const [timeframe, setTimeframe] = useState<BacktestTimeframe>("60");
  const [lookback, setLookback] = useState("2y");
  const [minGrade, setMinGrade] = useState("B");
  const [direction, setDirection] = useState("both");
  const [riskPct, setRiskPct] = useState("1");
  const [rrTarget, setRrTarget] = useState("2");
  const [atrStopMult, setAtrStopMult] = useState("1.2");
  const [maxHoldBars, setMaxHoldBars] = useState("40");
  const [sessions, setSessions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BtResult | null>(null);

  const toggleSession = (s: string) =>
    setSessions((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res: BacktestResponse = await run({
        data: {
          symbol,
          timeframe,
          lookback: lookback as "60d" | "1y" | "2y" | "5y",
          minGrade: minGrade as "A+" | "A" | "B" | "C",
          direction: direction as "both" | "long" | "short",
          riskPct: Number(riskPct),
          rrTarget: Number(rrTarget),
          atrStopMult: Number(atrStopMult),
          maxHoldBars: Number(maxHoldBars),
          sessions,
        },
      });
      if (res.ok) setResult(res.result);
      else {
        setResult(null);
        setError(res.error);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        icon={FlaskConical}
        title="Historical backtest"
        subtitle="Replay the signal rules bar by bar over past price history. Signals fill at the next bar's open and exits walk forward one bar at a time, so nothing uses future data."
      />

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                {BACKTEST_TIMEFRAMES.map((t) => (
                  <SelectItem key={t} value={t}>{TIMEFRAME_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lookback</Label>
            <Select value={lookback} onValueChange={setLookback}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="60d">60 days</SelectItem>
                <SelectItem value="1y">1 year</SelectItem>
                <SelectItem value="2y">2 years</SelectItem>
                <SelectItem value="5y">5 years</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Minimum grade</Label>
            <Select value={minGrade} onValueChange={setMinGrade}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A+">A+ only</SelectItem>
                <SelectItem value="A">A and better</SelectItem>
                <SelectItem value="B">B and better</SelectItem>
                <SelectItem value="C">C and better</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Direction</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Long and short</SelectItem>
                <SelectItem value="long">Long only</SelectItem>
                <SelectItem value="short">Short only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Risk per trade (%)</Label>
            <Input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Target (R multiple)</Label>
            <Input value={rrTarget} onChange={(e) => setRrTarget(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Stop (x ATR)</Label>
            <Input value={atrStopMult} onChange={(e) => setAtrStopMult(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max hold (bars)</Label>
            <Input value={maxHoldBars} onChange={(e) => setMaxHoldBars(e.target.value)} inputMode="numeric" />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3">
            <Label className="text-xs">Sessions (none selected means all)</Label>
            <div className="flex flex-wrap gap-2">
              {SESSIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSession(s)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    sessions.includes(s) ? "border-primary text-primary" : "border-border text-muted-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={submit} disabled={busy}>
            <Play className="mr-2 h-4 w-4" />
            {busy ? "Running" : "Run backtest"}
          </Button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </div>

      {result && <Results result={result} />}
    </div>
  );
}
