import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Layers, Check, X, RefreshCw } from "lucide-react";
import { PageInstructions } from "@/components/PageInstructions";
import { BACKTEST_SYMBOLS, BACKTEST_TIMEFRAMES, TIMEFRAME_LABEL, type BacktestTimeframe } from "@/lib/backtest/catalog";
import { WYCKOFF_RULEBOOK, WYCKOFF_RULEBOOK_VERSION } from "@/lib/wyckoff/rulebook";
import { runWyckoffScan, type WyckoffScan } from "@/lib/wyckoff/wyckoff.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/wyckoff")({
  head: () => ({
    meta: [
      { title: "Wyckoff mode, TradeMind" },
      {
        name: "description",
        content:
          "A stripped-back Wyckoff read: phase, spring or upthrust, protected level, structural target, and the five rules each setup is checked against.",
      },
      { property: "og:title", content: "Wyckoff mode, TradeMind" },
      {
        property: "og:description",
        content: "Phase, liquidity, location, stop and target - checked one rule at a time, with nothing else in the way.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WyckoffPage,
});

function num(n: number | null | undefined) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 1 : abs >= 100 ? 2 : abs >= 1 ? 3 : 5);
}

const PHASE_COPY: Record<string, string> = {
  accumulation: "Buyers absorbing supply inside a range. Stops below have been taken.",
  markup: "Range broken to the upside and holding. Pullbacks are buying opportunities until it fails.",
  distribution: "Sellers absorbing demand inside a range. Stops above have been taken.",
  markdown: "Range broken to the downside and holding. Rallies are selling opportunities until it fails.",
  consolidation: "A range with no character yet. Nothing has been taken, so there is nothing to do.",
  unreadable: "No readable phase on this series.",
};

function WyckoffPage() {
  const [ticker, setTicker] = useState<string>(BACKTEST_SYMBOLS[0]);
  const [interval, setInterval] = useState<BacktestTimeframe>("60");
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<WyckoffScan | null>(null);
  const run = useServerFn(runWyckoffScan);

  const go = async () => {
    setBusy(true);
    try {
      const result = await run({ data: { ticker, interval } });
      setScan(result);
    } catch (e) {
      toast.error((e as Error).message || "Could not read that market right now.");
    } finally {
      setBusy(false);
    }
  };

  const gradeTone =
    scan?.grade === "A+" || scan?.grade === "A"
      ? "text-bull border-bull/40"
      : scan?.grade === "NO ENTRY"
        ? "text-muted-foreground border-border/60"
        : "text-foreground border-border/60";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-2">
        <Layers className="size-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Wyckoff mode</h1>
        <span className="ml-auto text-[10px] tracking-tight text-muted-foreground border border-border/60 px-1.5 py-0.5">
          {WYCKOFF_RULEBOOK_VERSION}
        </span>
      </div>
      <PageInstructions className="mb-6" />
      <p className="text-sm text-muted-foreground mb-8 max-w-xl">
        One methodology, five rules, nothing else. This read is separate from the main scanner: it changes no
        published grade and stores nothing. Its job is to be practised and measured until the numbers are
        trustworthy.
      </p>

      <div className="flex flex-wrap items-end gap-2 mb-8">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Market
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            className="border border-border/60 bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {BACKTEST_SYMBOLS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Timeframe
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as BacktestTimeframe)}
            className="border border-border/60 bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {BACKTEST_TIMEFRAMES.map((t) => (
              <option key={t} value={t}>{TIMEFRAME_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="inline-flex items-center gap-2 border border-primary/50 bg-primary/10 px-3 py-2 text-sm font-medium text-primary disabled:opacity-50"
        >
          {busy ? <RefreshCw className="size-4 animate-spin" /> : null}
          {busy ? "Reading" : "Read this market"}
        </button>
      </div>

      {scan ? (
        <div className="space-y-6 mb-10">
          <div className="border border-border/60 bg-card/40">
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
              <span className="text-sm font-semibold">{scan.ticker}</span>
              <span className="text-xs text-muted-foreground">{TIMEFRAME_LABEL[scan.interval as BacktestTimeframe] ?? scan.interval}</span>
              <span className={`ml-auto border px-2 py-0.5 text-xs font-bold ${gradeTone}`}>{scan.grade}</span>
              <span className="text-xs text-muted-foreground">{scan.rulesPassed} of 5 rules</span>
            </div>

            <div className="px-4 py-3 space-y-1">
              <div className="text-sm">
                <span className="font-semibold capitalize">{scan.phase}</span>
                <span className="text-muted-foreground"> · {scan.bias}</span>
              </div>
              <p className="text-sm text-muted-foreground">{PHASE_COPY[scan.phase]}</p>
              {scan.cap ? <p className="text-sm text-red-300">{scan.cap}</p> : null}
            </div>

            {scan.entry !== null ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-t border-border/60 p-3">
                {([
                  ["Entry", num(scan.entry)],
                  ["Order", scan.entryOrder === "stop" ? "Pending stop" : "Pending limit"],
                  ["Stop", num(scan.stop)],
                  ["Target 1", num(scan.tp1)],
                  ["R:R", scan.rr !== null ? `${scan.rr.toFixed(2)}R` : "-"],
                ] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label} className="border border-border/50 bg-background/40 px-2 py-1">
                    <div className="text-[9px] tracking-tight text-muted-foreground">{label}</div>
                    <div className="font-mono text-[11px] text-foreground">{value}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
              Range {num(scan.range.low)} to {num(scan.range.high)} · ATR {num(scan.atr)} · {scan.barsRead} closed bars ·
              feed {scan.source}
            </div>
          </div>

          <div className="border border-border/60 bg-card/40">
            <div className="border-b border-border/60 px-4 py-2 text-sm font-semibold">Rule by rule</div>
            <ul className="divide-y divide-border/50">
              {scan.rules.map((r) => (
                <li key={r.id} className="flex gap-3 px-4 py-3">
                  {r.pass ? (
                    <Check className="size-4 shrink-0 text-bull" />
                  ) : (
                    <X className="size-4 shrink-0 text-red-400" />
                  )}
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{r.id}. {r.title}</div>
                    <p className="text-xs text-muted-foreground">{r.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {scan.events.length ? (
            <div className="border border-border/60 bg-card/40">
              <div className="border-b border-border/60 px-4 py-2 text-sm font-semibold">What happened</div>
              <ul className="divide-y divide-border/50">
                {scan.events.map((e, i) => (
                  <li key={`${e.kind}-${e.time}-${i}`} className="px-4 py-2 text-xs text-muted-foreground">
                    <span className="mr-2 font-semibold uppercase tracking-tight text-foreground">{e.kind}</span>
                    {e.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {scan.bos ? (
            <div className="border border-border/60 bg-card/40 px-4 py-3 text-xs text-muted-foreground">
              <span className="mr-2 font-semibold text-foreground">
                {scan.bos.quality === "protected" ? "Protected break" : "Unprotected break"}
              </span>
              {scan.bos.reason}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border border-border/60 bg-card/40">
        <div className="border-b border-border/60 px-4 py-2 text-sm font-semibold">The rulebook</div>
        <ul className="divide-y divide-border/50">
          {WYCKOFF_RULEBOOK.map((r) => (
            <li key={r.id} className="px-4 py-3 space-y-1">
              <div className="text-sm font-medium">{r.id}. {r.title}</div>
              <p className="text-xs text-foreground/90">{r.rule}</p>
              <p className="text-xs text-muted-foreground">{r.why}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
