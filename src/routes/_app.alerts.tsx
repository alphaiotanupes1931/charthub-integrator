import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

import { Bell, Plus, Trash2, Power, PowerOff, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { toast } from "sonner";
import {
  listMyPriceAlerts,
  createPriceAlert,
  deletePriceAlert,
  togglePriceAlert,
  type PriceAlertRow,
} from "@/lib/price-alerts.functions";

export const Route = createFileRoute("/_app/alerts")({
  head: () => ({ meta: [{ title: "Price Alerts, TradeMind" }] }),
  component: AlertsPage,
});

const SYMBOL_SUGGESTIONS = ["XAU/USD", "EUR/USD", "GBP/USD", "USD/JPY", "NAS100", "SPX500", "US30", "BTC/USD", "ETH/USD"];

function AlertsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMyPriceAlerts);
  const createFn = useServerFn(createPriceAlert);
  const deleteFn = useServerFn(deletePriceAlert);
  const toggleFn = useServerFn(togglePriceAlert);

  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) setHasSession(!!data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setHasSession(!!session);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["price-alerts"],
    queryFn: () => listFn(),
    refetchInterval: 20_000,
    enabled: hasSession,
  });
  const rows: PriceAlertRow[] = data?.rows ?? [];


  const invalidate = () => qc.invalidateQueries({ queryKey: ["price-alerts"] });

  const mCreate = useMutation({
    mutationFn: (payload: { symbol: string; side: "above" | "below"; price: number; note?: string; auto_delete: boolean }) =>
      createFn({ data: payload }),
    onSuccess: () => { invalidate(); toast.success("Alert created"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const mDelete = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
  });
  const mToggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => toggleFn({ data: v }),
    onSuccess: invalidate,
  });

  const [symbol, setSymbol] = useState("XAU/USD");
  const [side, setSide] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [autoDelete, setAutoDelete] = useState(true);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(price);
    if (!symbol.trim() || !Number.isFinite(n) || n <= 0) {
      toast.error("Enter a symbol and a positive price");
      return;
    }
    mCreate.mutate({ symbol: symbol.trim(), side, price: n, note: note.trim() || undefined, auto_delete: autoDelete });
    setPrice("");
    setNote("");
  };

  const active = rows.filter((r) => r.active && !r.triggered_at);
  const done = rows.filter((r) => !r.active || r.triggered_at);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      <header className="flex items-center gap-3 mb-6">
        <div className="rounded-lg bg-primary/10 p-2 text-primary"><Bell className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Price Alerts</h1>
          <p className="text-sm text-muted-foreground">Get notified the moment a symbol crosses your target. Checked every minute.</p>
        </div>
      </header>

      <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-4 md:p-5 mb-8 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_1fr] gap-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Symbol</label>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              list="symbol-suggestions"
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              placeholder="XAU/USD"
            />
            <datalist id="symbol-suggestions">
              {SYMBOL_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">When price is</label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as "above" | "below")}
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Price</label>
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              type="number"
              step="any"
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              placeholder="2400.00"
            />
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            placeholder="Breakout of Asia range"
          />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={autoDelete} onChange={(e) => setAutoDelete(e.target.checked)} />
            Auto-delete after firing
          </label>
          <button
            type="submit"
            disabled={mCreate.isPending}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {mCreate.isPending ? "Adding…" : "Add alert"}
          </button>
        </div>
      </form>

      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Active ({active.length})</h2>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No active alerts. Add one above.
          </div>
        ) : (
          <ul className="space-y-2">
            {active.map((row) => <AlertItem key={row.id} row={row} onDelete={() => mDelete.mutate(row.id)} onToggle={() => mToggle.mutate({ id: row.id, active: false })} />)}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Recently fired / paused</h2>
          <ul className="space-y-2">
            {done.map((row) => <AlertItem key={row.id} row={row} onDelete={() => mDelete.mutate(row.id)} onToggle={() => mToggle.mutate({ id: row.id, active: true })} muted />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function AlertItem({ row, onDelete, onToggle, muted }: { row: PriceAlertRow; onDelete: () => void; onToggle: () => void; muted?: boolean }) {
  const Icon = row.side === "above" ? ArrowUpRight : ArrowDownRight;
  return (
    <li className={`flex items-center gap-3 rounded-xl border border-border bg-card p-3 ${muted ? "opacity-70" : ""}`}>
      <div className={`rounded-md p-2 ${row.side === "above" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">
          {row.symbol} {row.side === "above" ? "≥" : "≤"} {row.price}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {row.triggered_at ? `Fired ${new Date(row.triggered_at).toLocaleString()}` : row.last_checked_price != null ? `Last check ${row.last_checked_price}` : "Awaiting first check"}
          {row.note ? ` — ${row.note}` : ""}
        </div>
      </div>
      <button
        onClick={onToggle}
        title={row.active ? "Pause" : "Reactivate"}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {row.active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
      </button>
      <button
        onClick={onDelete}
        title="Delete"
        className="rounded-md p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
