import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  listManualRevenue,
  upsertManualRevenue,
  deleteManualRevenue,
} from "@/lib/revenue.functions";

type Row = Awaited<ReturnType<typeof listManualRevenue>>[number];

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function RevenuePanel({ onMrrChange }: { onMrrChange?: (mrrCents: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "", amount: "", note: "" });
  const [busy, setBusy] = useState(false);

  const publish = (list: Row[]) => {
    onMrrChange?.(list.filter((r) => r.active).reduce((s, r) => s + Number(r.monthly_amount_cents), 0));
  };

  const load = async () => {
    try {
      const list = (await listManualRevenue()) as Row[];
      setRows(list);
      publish(list);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => {
    setDraft({ name: "", email: "", amount: "", note: "" });
    setEditing("new");
  };

  const startEdit = (r: Row) => {
    setDraft({
      name: r.name,
      email: r.email ?? "",
      amount: (Number(r.monthly_amount_cents) / 100).toString(),
      note: r.note ?? "",
    });
    setEditing(r.id);
  };

  const save = async () => {
    const cents = Math.round(Number(draft.amount || 0) * 100);
    if (!draft.name.trim() || Number.isNaN(cents)) {
      toast.error("Add a name and a monthly amount");
      return;
    }
    setBusy(true);
    try {
      await upsertManualRevenue({
        data: {
          ...(editing && editing !== "new" ? { id: editing } : {}),
          name: draft.name.trim(),
          email: draft.email.trim() || null,
          monthlyAmountCents: cents,
          note: draft.note.trim() || null,
          active: true,
        },
      });
      setEditing(null);
      await load();
      toast.success("Saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Row) => {
    if (!confirm(`Remove ${r.name} from monthly revenue?`)) return;
    setBusy(true);
    try {
      await deleteManualRevenue({ data: { id: r.id } });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mrr = (rows ?? []).filter((r) => r.active).reduce((s, r) => s + Number(r.monthly_amount_cents), 0);

  return (
    <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Monthly recurring revenue</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manual entries for now. These get replaced automatically once the Stripe webhook is live.
          </p>
        </div>
        <button
          onClick={startNew}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {err && <div className="px-5 py-3 text-sm text-destructive bg-destructive/5">{err}</div>}

      <div className="divide-y divide-border">
        {editing === "new" && (
          <DraftRow draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setEditing(null)} busy={busy} />
        )}
        {rows === null ? (
          <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </div>
        ) : rows.length === 0 && editing !== "new" ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">No paying customers entered yet.</div>
        ) : (
          rows.map((r) =>
            editing === r.id ? (
              <DraftRow
                key={r.id}
                draft={draft}
                setDraft={setDraft}
                onSave={save}
                onCancel={() => setEditing(null)}
                busy={busy}
              />
            ) : (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {r.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.email || r.note || "Manual entry"}
                  </div>
                </div>
                <div className="tabular-nums text-sm font-semibold">{money(Number(r.monthly_amount_cents))}<span className="text-xs font-normal text-muted-foreground">/mo</span></div>
                <button
                  onClick={() => startEdit(r)}
                  className="rounded-full border border-border/60 p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label={`Edit ${r.name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => void remove(r)}
                  disabled={busy}
                  className="rounded-full border border-border/60 p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  aria-label={`Remove ${r.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ),
          )
        )}
      </div>

      <div className="flex items-center justify-between px-5 py-4 border-t border-border/60 bg-muted/30">
        <span className="text-xs tracking-tight text-muted-foreground">Total MRR</span>
        <span className="text-xl font-semibold tabular-nums">{money(mrr)}</span>
      </div>
    </section>
  );
}

function DraftRow({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
}: {
  draft: { name: string; email: string; amount: string; note: string };
  setDraft: (d: { name: string; email: string; amount: string; note: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const input =
    "rounded-full border border-border/60 bg-background px-3 py-1.5 text-sm outline-none focus:border-foreground/40";
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3.5 bg-muted/20">
      <input
        autoFocus
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="Name"
        className={`${input} w-40`}
      />
      <input
        value={draft.email}
        onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        placeholder="Email, optional"
        className={`${input} w-52`}
      />
      <input
        value={draft.amount}
        onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
        inputMode="decimal"
        placeholder="Amount per month"
        className={`${input} w-36`}
      />
      <input
        value={draft.note}
        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        placeholder="Note, optional"
        className={`${input} w-44`}
      />
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border border-border/60 p-1.5 text-muted-foreground hover:bg-muted"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
