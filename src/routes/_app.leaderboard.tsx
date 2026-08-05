import { PageInstructions } from "@/components/PageInstructions";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Trophy, RefreshCw, Medal } from "lucide-react";
import { getLeaderboard, getMyOptIn, setMyOptIn, type LeaderboardRow } from "@/lib/leaderboard.functions";

export const Route = createFileRoute("/_app/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — TradeMind" },
      { name: "description", content: "Public paper-trading leaderboard. Opt in with a handle to appear." },
      { property: "og:title", content: "TradeMind Leaderboard" },
      { property: "og:description", content: "Top paper traders on TradeMind, ranked by P/L%." },
    ],
  }),
  component: LeaderboardPage,
});

type OptIn = { handle: string; opted_in: boolean; updated_at: string } | null;

function LeaderboardPage() {
  const fetchBoard = useServerFn(getLeaderboard);
  const fetchOptIn = useServerFn(getMyOptIn);
  const saveOptIn = useServerFn(setMyOptIn);

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [mine, setMine] = useState<OptIn>(null);
  const [handle, setHandle] = useState("");
  const [optedIn, setOptedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [b, o] = await Promise.all([fetchBoard(), fetchOptIn().catch(() => null)]);
      setRows(b);
      setMine(o);
      if (o) { setHandle(o.handle); setOptedIn(o.opted_in); }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save() {
    if (!/^[A-Za-z0-9_-]{2,24}$/.test(handle)) {
      toast.error("Handle must be 2-24 letters, numbers, - or _");
      return;
    }
    setSaving(true);
    try {
      await saveOptIn({ data: { handle, opted_in: optedIn } });
      toast.success(optedIn ? "You are on the leaderboard" : "Opted out");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-semibold mb-2 flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" /> Leaderboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Public ranking of paper-trading accounts by P/L%. Opt in with a handle to appear.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <PageInstructions className="mb-6" />

      <div className="rounded-md border border-border bg-card p-5 mb-6">
        <div className="text-sm font-semibold mb-3">Your visibility</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block sm:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Display handle</div>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="e.g. calm_trader"
              maxLength={24}
              className="w-full px-2 py-1.5 rounded-md bg-background border border-border text-sm font-mono"
            />
          </label>
          <label className="flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={optedIn}
              onChange={(e) => setOptedIn(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm">Show me publicly</span>
          </label>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : mine ? "Update" : "Join leaderboard"}
        </button>
        <p className="text-xs text-muted-foreground mt-2">
          Only your handle, equity, P/L%, trades, and win rate are shared. Your real name and email are never published.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
          <span>#</span>
          <span>Trader</span>
          <span className="text-right">P/L%</span>
          <span className="text-right">Equity</span>
          <span className="text-right">Trades</span>
          <span className="text-right">Win%</span>
        </div>
        {loading && rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No public traders yet. Be the first — opt in above.
          </div>
        ) : (
          rows.map((r, i) => {
            const isMe = mine?.opted_in && mine.handle.toLowerCase() === r.handle.toLowerCase();
            const pnlPos = Number(r.pnl_pct) >= 0;
            return (
              <div
                key={r.handle}
                className={`grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem] gap-3 px-4 py-2.5 text-sm border-b border-border/50 last:border-0 ${
                  isMe ? "bg-primary/5" : ""
                }`}
              >
                <span className="font-mono text-muted-foreground flex items-center gap-1">
                  {i < 3 ? <Medal className={`h-3.5 w-3.5 ${i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : "text-orange-400"}`} /> : null}
                  {i + 1}
                </span>
                <span className="font-mono truncate">{r.handle}{isMe && <span className="ml-2 text-[10px] text-primary">you</span>}</span>
                <span className={`text-right font-mono ${pnlPos ? "text-bull" : "text-red-300"}`}>
                  {pnlPos ? "+" : ""}{Number(r.pnl_pct).toFixed(2)}%
                </span>
                <span className="text-right font-mono">${Number(r.equity).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span className="text-right font-mono">{r.trades}</span>
                <span className="text-right font-mono">{Number(r.win_rate).toFixed(0)}%</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
