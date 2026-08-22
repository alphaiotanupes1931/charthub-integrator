import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/PageHeader";
import { Radar, TrendingUp, TrendingDown, Minus, Loader2, RefreshCw, BookOpen, History, Trash2, Zap } from "lucide-react";
import { runSignalScan, type Signal } from "@/lib/agents/signal-engine.functions";
import {
  listSignals,
  onSignalHistoryChange,
  recordSignal,
  takeTrade,
  setSignalOutcome,
  clearSignalHistory,
  deleteSignal,
  type SignalRecord,
} from "@/lib/signalHistory";
import { CapabilityGate } from "@/components/CapabilityGate";


export const Route = createFileRoute("/_app/signals")({
  head: () => ({ meta: [{ title: "AI Signals, TradeMind" }] }),
  component: SignalsRoute,
});

const TF_OPTIONS = [
  { v: "15", l: "15m" },
  { v: "60", l: "1H" },
  { v: "240", l: "4H" },
  { v: "D", l: "1D" },
];

const num = (s?: string): number | undefined => {
  if (!s || s === "-") return undefined;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

function SignalsRoute() {
  return (
    <CapabilityGate
      capability="signal_engine"
      reason="signals"
      title="The signal engine is part of the paid plan"
      body="Free accounts get 3 signal grades a month on the dashboard. Upgrade to scan every instrument on demand."
    >
      <SignalsPage />
    </CapabilityGate>
  );
}

function SignalsPage() {
  const navigate = useNavigate();
  const scan = useServerFn(runSignalScan);
  const [interval, setInterval] = useState("60");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<SignalRecord[]>([]);

  useEffect(() => {
    const sync = () => setHistory(listSignals());
    sync();
    return onSignalHistoryChange(sync);
  }, []);

  const mut = useMutation({
    mutationFn: async () => scan({ data: { interval } }),
    onSuccess: (data) => {
      setSignals(data);
      setScannedAt(new Date().toLocaleTimeString());
      for (const s of data) {
        recordSignal({
          symbol: s.ticker,
          interval,
          grade: s.grade,
          bias: s.action === "BUY" ? "Long" : s.action === "SELL" ? "Short" : "Neutral",
          entry: num(s.entry),
          stop: num(s.stop),
          tp1: num(s.tp1),
          rr: s.rr,
          synopsis: s.notes,
          source: "engine",
        });
      }
      setHistory(listSignals());
    },
  });


  const grouped = {
    BUY: signals.filter((s) => s.action === "BUY").sort((a, b) => b.confidence - a.confidence),
    SELL: signals.filter((s) => s.action === "SELL").sort((a, b) => b.confidence - a.confidence),
    HOLD: signals.filter((s) => s.action === "HOLD"),
  };

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="AI Signal Engine"
        description="Scans a watchlist through the 3-layer research stack and returns BUY/SELL/HOLD calls with entries, stops and targets."
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center gap-1 rounded-xl border border-border/60 p-1">
          {TF_OPTIONS.map((o) => (
            <button
              key={o.v}
              onClick={() => setInterval(o.v)}
              className={`px-3 py-1 text-xs rounded ${interval === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >{o.l}</button>
          ))}
        </div>
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {mut.isPending ? "Scanning 8 markets…" : "Run Scan"}
        </button>
        {scannedAt && <div className="text-xs text-muted-foreground">Last scan: {scannedAt}</div>}
      </div>

      {mut.isError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-500">
          Scan failed. Try again in a moment.
        </div>
      )}

      {signals.length === 0 && !mut.isPending && (
        <div className="rounded-xl border border-border/60 bg-card p-12 text-center space-y-4">
          <Radar className="h-10 w-10 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-semibold">Ready to scan</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            The engine reads market data, runs 4 analyst personas per instrument, then produces a trade plan graded A+ to NO ENTRY.
          </p>
        </div>
      )}

      {signals.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SignalColumn title="BUY" tone="buy" signals={grouped.BUY} onClick={(t) => navigate({ to: "/dashboard", search: { symbol: t, scan: "1" } as never })} />
          <SignalColumn title="SELL" tone="sell" signals={grouped.SELL} onClick={(t) => navigate({ to: "/dashboard", search: { symbol: t, scan: "1" } as never })} />
          <SignalColumn title="HOLD" tone="hold" signals={grouped.HOLD} onClick={(t) => navigate({ to: "/dashboard", search: { symbol: t, scan: "1" } as never })} />
        </div>
      )}

      <SignalHistory
        records={history}
        onOpen={(t) => navigate({ to: "/dashboard", search: { symbol: t, scan: "1" } as never })}
      />



      <div className="text-xs text-muted-foreground">
        Signals are AI-generated and educational. Not financial advice. Use with the <Link to="/journal" className="text-primary underline">journal</Link> to track outcomes.
      </div>
    </div>
  );
}

function SignalHistory({ records, onOpen }: { records: SignalRecord[]; onOpen: (ticker: string) => void }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" /> Signal history
          <span className="font-normal text-muted-foreground">({records.length})</span>
        </div>
        {records.length > 0 && (
          <button
            onClick={() => clearSignalHistory()}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Every scan you run, here and on the chart, is saved to this list.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {records.slice(0, 50).map((r) => {
            const when = new Date(r.at);
            const dir = r.bias === "Long" ? "text-bull" : r.bias === "Short" ? "text-red-500" : "text-muted-foreground";
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-xs">
                <button onClick={() => onOpen(r.symbol)} className="font-semibold text-sm hover:underline">
                  {r.symbol}
                </button>
                <span className="rounded border border-border/60 px-1.5 py-0.5 font-semibold">{r.grade}</span>
                <span className={`font-semibold tracking-tight ${dir}`}>{r.bias}</span>
                <span className="text-muted-foreground">
                  {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="font-mono text-muted-foreground">
                  {r.entry != null ? `E ${r.entry}` : ""} {r.stop != null ? `· S ${r.stop}` : ""} {r.tp1 != null ? `· TP ${r.tp1}` : ""}
                </span>
                <div className="flex-1" />
                {r.taken ? (
                  <div className="flex items-center gap-1">
                    <span className="rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">Taken</span>
                    {(["win", "loss", "breakeven"] as const).map((o) => (
                      <button
                        key={o}
                        onClick={() => setSignalOutcome(r.id, r.outcome === o ? null : o)}
                        className={`rounded border px-1.5 py-0.5 capitalize ${
                          r.outcome === o ? "border-primary bg-primary/15 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                ) : (
                  r.bias !== "Neutral" && (
                    <div className="flex flex-col items-stretch gap-1">
                      <button
                        onClick={() => takeTrade(r)}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-2 py-1 font-semibold text-primary-foreground hover:opacity-90"
                      >
                        <BookOpen className="h-3 w-3" /> Log this trade
                      </button>

                    </div>
                  )

                )}
                <button
                  onClick={() => deleteSignal(r.id)}
                  className="rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Delete signal"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function SignalColumn({ title, tone, signals, onClick }: { title: string; tone: "buy" | "sell" | "hold"; signals: Signal[]; onClick: (ticker: string) => void }) {
  const Icon = tone === "buy" ? TrendingUp : tone === "sell" ? TrendingDown : Minus;
  const color = tone === "buy" ? "text-bull" : tone === "sell" ? "text-red-500" : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className={`flex items-center gap-2 text-sm font-semibold mb-3 ${color}`}>
        <Icon className="h-4 w-4" /> {title} <span className="text-muted-foreground font-normal">({signals.length})</span>
      </div>
      <div className="space-y-2">
        {signals.length === 0 && <div className="text-xs text-muted-foreground py-4 text-center">No {title.toLowerCase()} signals</div>}
        {signals.map((s) => (
          <button key={s.ticker} onClick={() => onClick(s.ticker)} className="w-full text-left rounded-xl border border-border/60 p-3 hover:bg-muted/40 transition">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">{s.ticker}</div>
              <div className="text-xs px-1.5 py-0.5 rounded bg-muted">{s.grade}</div>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{s.action}</span>
              <span>R:R {s.rr}</span>
            </div>
            {s.action !== "HOLD" && (
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                <div>Entry <div className="text-foreground">{s.entry}</div></div>
                <div>Stop <div className="text-foreground">{s.stop}</div></div>
                <div>TP1 <div className="text-foreground">{s.tp1}</div></div>
              </div>
            )}
            <div className="mt-2 text-xs text-muted-foreground line-clamp-2">{s.notes}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
