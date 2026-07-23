import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  getPaperState,
  setTestingMode,
  resetPaperAccount,
  resumePaperAccount,
  openPaperPosition,
  closePaperPosition,
} from "@/lib/paper-engine.functions";
import { AlertTriangle, Play, Square, RotateCcw, X } from "lucide-react";

export const Route = createFileRoute("/_app/testing")({
  head: () => ({ meta: [{ title: "Testing, TradeMind" }] }),
  component: TestingPage,
});

function fmtMoney(n: number | string) {
  const v = Number(n);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function TestingPage() {
  const qc = useQueryClient();
  const getState = useServerFn(getPaperState);
  const state = useQuery({ queryKey: ["paperState"], queryFn: () => getState(), refetchInterval: 15_000 });

  const toggle = useMutation({
    mutationFn: useServerFn(setTestingMode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["paperState"] }); },
  });
  const reset = useMutation({
    mutationFn: useServerFn(resetPaperAccount),
    onSuccess: () => { toast.success("Paper account reset to $10,000"); qc.invalidateQueries({ queryKey: ["paperState"] }); },
  });
  const resume = useMutation({
    mutationFn: useServerFn(resumePaperAccount),
    onSuccess: () => { toast.success("Trading resumed"); qc.invalidateQueries({ queryKey: ["paperState"] }); },
  });
  const closePos = useMutation({
    mutationFn: useServerFn(closePaperPosition),
    onSuccess: () => { toast.success("Position closed"); qc.invalidateQueries({ queryKey: ["paperState"] }); },
  });
  const openPos = useMutation({
    mutationFn: useServerFn(openPaperPosition),
    onSuccess: () => { toast.success("Position opened"); qc.invalidateQueries({ queryKey: ["paperState"] }); setShowNew(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ symbol: "XAU/USD", side: "long" as "long" | "short", size: "1", entry: "", stop: "", takeProfit: "" });

  if (state.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading paper account…</div>;
  const s = state.data;
  if (!s) return <div className="p-6 text-sm text-muted-foreground">No paper account yet.</div>;

  const equity = Number(s.account.balance);
  const peak = Number(s.account.peak_equity);
  const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
  const pnlTotal = equity - Number(s.account.starting_balance);
  const wins = s.trades.filter((t: any) => Number(t.pnl) > 0).length;
  const winRate = s.trades.length ? (wins / s.trades.length) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Testing (paper trading)</h1>
          <p className="text-sm text-muted-foreground">Simulated account. No real money. Fills against live prices.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggle.mutate({ data: { enabled: !s.account.testing_mode } })}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${s.account.testing_mode ? "bg-emerald-600 text-white" : "bg-muted text-foreground"}`}
          >
            {s.account.testing_mode ? <><Play className="size-4" /> Testing ON</> : <><Square className="size-4" /> Testing OFF</>}
          </button>
        </div>
      </header>

      {s.account.status === "paused_for_review" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-destructive">Trading paused — kill switch triggered</div>
            <p className="text-sm text-muted-foreground mt-1">{s.account.paused_reason}</p>
            <button onClick={() => resume.mutate({})} disabled={resume.isPending} className="mt-3 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
              I've reviewed. Resume trading
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Equity" value={fmtMoney(equity)} />
        <Stat label="Peak" value={fmtMoney(peak)} />
        <Stat label="P&L" value={fmtMoney(pnlTotal)} tone={pnlTotal >= 0 ? "pos" : "neg"} />
        <Stat label="Drawdown from peak" value={`${drawdown.toFixed(2)}%`} tone={drawdown >= 10 ? "neg" : "neutral"} />
        <Stat label="Trades closed" value={String(s.trades.length)} />
        <Stat label="Win rate" value={`${winRate.toFixed(0)}%`} />
        <Stat label="Open positions" value={String(s.positions.length)} />
        <Stat label="Status" value={s.account.status} />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setShowNew((v) => !v)} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          {showNew ? "Cancel" : "New paper trade"}
        </button>
        <button onClick={() => { if (confirm("Reset paper account to $10,000? Wipes trades and equity history.")) reset.mutate({ data: {} }); }} className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm">
          <RotateCcw className="size-4" /> Reset to $10,000
        </button>
      </div>

      {showNew && (
        <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Leave <span className="font-medium text-foreground">Entry</span> blank to open at the current market price. Stop and Take Profit are optional.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <input className="rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            <select className="rounded border border-border bg-background px-2 py-1.5 text-sm" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as "long" | "short" })}>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <input className="rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Size" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} />
            <input className="rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Entry (market)" value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })} />
            <input className="rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Stop (optional)" value={form.stop} onChange={(e) => setForm({ ...form, stop: e.target.value })} />
            <input className="rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="Take Profit (optional)" value={form.takeProfit} onChange={(e) => setForm({ ...form, takeProfit: e.target.value })} />
          </div>
          <button
            onClick={() => {
              const size = Number(form.size);
              if (!form.symbol.trim()) { toast.error("Enter a symbol"); return; }
              if (!Number.isFinite(size) || size <= 0) { toast.error("Size must be greater than 0"); return; }
              const entry = form.entry.trim() ? Number(form.entry) : undefined;
              const stop = form.stop.trim() ? Number(form.stop) : undefined;
              const takeProfit = form.takeProfit.trim() ? Number(form.takeProfit) : undefined;
              if (entry !== undefined && !(entry > 0)) { toast.error("Entry must be greater than 0 (or leave blank for market)"); return; }
              if (stop !== undefined && !(stop > 0)) { toast.error("Stop must be greater than 0 (or leave blank)"); return; }
              if (takeProfit !== undefined && !(takeProfit > 0)) { toast.error("Take Profit must be greater than 0 (or leave blank)"); return; }
              openPos.mutate({ data: { symbol: form.symbol.trim(), side: form.side, size, entry, stop, takeProfit } });
            }}
            disabled={openPos.isPending}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {openPos.isPending ? "Opening…" : form.entry.trim() ? "Open position" : "Open at market"}
          </button>
        </div>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">Open positions</h2>
        {s.positions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open positions.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Symbol</th><th className="text-left p-2">Side</th><th className="text-right p-2">Size</th>
                  <th className="text-right p-2">Entry</th><th className="text-right p-2">Stop</th><th className="text-right p-2">TP</th>
                  <th className="text-left p-2">Grade</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {s.positions.map((p: any) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-2">{p.symbol}</td>
                    <td className="p-2 capitalize">{p.side}</td>
                    <td className="p-2 text-right">{p.size}</td>
                    <td className="p-2 text-right">{p.entry}</td>
                    <td className="p-2 text-right">{p.stop}</td>
                    <td className="p-2 text-right">{p.take_profit ?? "—"}</td>
                    <td className="p-2">{p.grade ?? "—"}</td>
                    <td className="p-2 text-right">
                      <button onClick={() => closePos.mutate({ data: { id: p.id } })} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs">
                        <X className="size-3" /> Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Closed trades</h2>
        {s.trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trades yet.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Closed</th><th className="text-left p-2">Symbol</th><th className="text-left p-2">Side</th>
                  <th className="text-right p-2">Entry</th><th className="text-right p-2">Exit</th>
                  <th className="text-right p-2">P&L</th><th className="text-left p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {s.trades.map((t: any) => {
                  const pnl = Number(t.pnl);
                  return (
                    <tr key={t.id} className="border-t border-border">
                      <td className="p-2 text-xs text-muted-foreground">{new Date(t.closed_at).toLocaleString()}</td>
                      <td className="p-2">{t.symbol}</td>
                      <td className="p-2 capitalize">{t.side}</td>
                      <td className="p-2 text-right">{t.entry}</td>
                      <td className="p-2 text-right">{t.exit}</td>
                      <td className={`p-2 text-right ${pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmtMoney(pnl)}</td>
                      <td className="p-2 uppercase text-xs">{t.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "neutral" }) {
  const cls = tone === "pos" ? "text-emerald-500" : tone === "neg" ? "text-red-500" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
