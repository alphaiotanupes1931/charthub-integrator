import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { listManualRevenue } from "@/lib/revenue.functions";
import { csvDate, downloadCsv } from "@/lib/csv-export";


export type AiSpendRow = { user_id: string; email: string | null; cost_usd: number; calls: number };
export type SimpleUser = { id: string; email: string | null; display_name: string | null; role?: string | null };

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Line = {
  key: string;
  name: string;
  email: string | null;
  pays: number;
  aiSpend: number;
  calls: number;
  isAdmin: boolean;
};


/**
 * Money view: what each person pays, what their AI use costs, what is left over.
 * Dollars only, one row per person, totals at the bottom.
 */
export function CustomerMoneyTable({
  users,
  aiSpend,
  onTotals,
}: {
  users: SimpleUser[] | null;
  aiSpend: AiSpendRow[];
  onTotals?: (t: { gross: number; aiCost: number; profit: number }) => void;
}) {
  const [revenue, setRevenue] = useState<Awaited<ReturnType<typeof listManualRevenue>> | null>(null);
  const [limit, setLimit] = useState(5);

  useEffect(() => {
    listManualRevenue()
      .then((r) => setRevenue(r))
      .catch(() => setRevenue([]));
  }, []);

  const lines = useMemo<Line[]>(() => {
    const paying = new Map<string, { name: string; amount: number }>();
    for (const r of revenue ?? []) {
      if (!r.active) continue;
      const email = (r.email ?? "").trim().toLowerCase();
      if (email) paying.set(email, { name: r.name, amount: Number(r.monthly_amount_cents) / 100 });
    }
    const spendByUser = new Map(aiSpend.map((r) => [r.user_id, r]));
    const spendByEmail = new Map(
      aiSpend.filter((r) => r.email).map((r) => [r.email!.trim().toLowerCase(), r]),
    );

    const out: Line[] = (users ?? []).map((u) => {
      const email = (u.email ?? "").trim().toLowerCase();
      const spend = spendByUser.get(u.id) ?? (email ? spendByEmail.get(email) : undefined);
      const pay = email ? paying.get(email) : undefined;
      if (email) paying.delete(email);
      return {
        key: u.id,
        name: u.display_name ?? pay?.name ?? u.email ?? "Unknown",
        email: u.email,
        pays: pay?.amount ?? 0,
        aiSpend: Number(spend?.cost_usd ?? 0),
        calls: Number(spend?.calls ?? 0),
        isAdmin: (u.role ?? "user") === "admin",
      };
    });

    // Paying people who do not have an app account yet.
    for (const [email, pay] of paying) {
      out.push({ key: `rev-${email}`, name: pay.name, email, pays: pay.amount, aiSpend: 0, calls: 0, isAdmin: false });
    }

    return out.sort((a, b) => b.pays - a.pays || b.aiSpend - a.aiSpend);
  }, [users, aiSpend, revenue]);

  const gross = lines.reduce((s, l) => s + l.pays, 0);
  const aiCost = lines.reduce((s, l) => s + l.aiSpend, 0);
  const profit = gross - aiCost;
  const totalCalls = lines.reduce((s, l) => s + l.calls, 0);

  useEffect(() => {
    onTotals?.({ gross, aiCost, profit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gross, aiCost, profit]);
  const exportCsv = () => {
    downloadCsv(
      `profit-per-person-${csvDate()}.csv`,
      ["Name", "Email", "Admin", "Pays per month USD", "AI cost USD", "AI calls", "You keep USD"],
      [
        ...lines.map((l) => [
          l.name,
          l.email ?? "",
          l.isAdmin ? "yes" : "no",
          l.pays.toFixed(2),
          l.aiSpend.toFixed(4),
          l.calls,
          (l.pays - l.aiSpend).toFixed(2),
        ]),
        ["TOTAL", "", "", gross.toFixed(2), aiCost.toFixed(4), totalCalls, profit.toFixed(2)],
      ],
    );
  };

  return (
    <section className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Money per person, this month</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            What they pay, what their AI use costs you, what you keep.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            AI limit per person
            <span className="inline-flex items-center rounded-full border border-border/60 bg-background px-2.5 py-1 text-foreground">
              $
              <input
                value={limit}
                onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
                inputMode="decimal"
                className="w-12 bg-transparent text-sm outline-none tabular-nums"
              />
            </span>
          </label>
          <button
            onClick={exportCsv}
            disabled={lines.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>


      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-2 text-left font-medium">Person</th>
              <th className="px-4 py-2 text-right font-medium">Pays / mo</th>
              <th className="px-4 py-2 text-right font-medium">AI used / limit</th>
              <th className="px-5 py-2 text-right font-medium">You keep</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users === null || revenue === null ? (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading
                </td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-muted-foreground">Nobody to show yet.</td>
              </tr>
            ) : (
              lines.map((l) => {
                const over = !l.isAdmin && limit > 0 && l.aiSpend > limit;
                const keep = l.pays - l.aiSpend;
                return (
                  <tr key={l.key}>
                    <td className="px-5 py-3">
                      <div className="font-medium flex items-center gap-2">
                        {l.name}
                        {l.isAdmin && (
                          <span className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[240px]">{l.email ?? "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">
                      {l.pays > 0 ? usd(l.pays) : <span className="text-muted-foreground">Free</span>}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums font-medium ${over ? "text-destructive" : ""}`}>
                      {usd(l.aiSpend)}
                      <span className="text-xs font-normal text-muted-foreground">
                        {l.isAdmin ? " / no limit" : ` / ${usd(limit)}`}
                      </span>
                    </td>
                    <td
                      className={`px-5 py-3 text-right tabular-nums font-semibold ${keep < 0 ? "text-destructive" : keep > 0 ? "text-bull" : "text-muted-foreground"}`}
                    >
                      {usd(keep)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot className="bg-muted/30 text-sm">
            <tr className="border-t border-border/60">
              <td className="px-5 py-4 font-semibold">Total</td>
              <td className="px-4 py-4 text-right tabular-nums font-semibold">{usd(gross)}</td>
              <td className="px-4 py-4 text-right tabular-nums font-semibold">{usd(aiCost)}</td>
              <td className={`px-5 py-4 text-right text-lg tabular-nums font-semibold ${profit < 0 ? "text-destructive" : "text-bull"}`}>
                {usd(profit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-border/60 text-[11px] text-muted-foreground">
        {totalCalls.toLocaleString()} AI calls counted this month. Money you keep is what they pay minus their AI cost.
      </div>
    </section>
  );
}
