import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { Loader2, ShieldAlert, Users, BarChart3, CircleDot, CircleOff, CircleDashed, Ban, ShieldCheck, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { adminReferralStats, adminUsersOverview, adminSetPlatformStatus, adminUsageToday } from "@/lib/admin.functions";
import { aiCostSummary } from "@/lib/ai-cost.functions";
import { aiCreditsStatus, setAiBudget } from "@/lib/ai-credits.functions";
import { adminListSupportRequests } from "@/lib/support.functions";
import { RevenuePanel } from "@/components/admin/RevenuePanel";
import { CustomerMoneyTable } from "@/components/admin/CustomerMoneyTable";
import { AiAveragesPanel } from "@/components/admin/AiAveragesPanel";



export const Route = createFileRoute("/_app/admin")({
  head: () => ({ meta: [{ title: "Admin, TradeMind" }] }),
  component: AdminPage,
});

type ReferralRow = { source: string; count: number };
type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  referral_source: string | null;
  onboarded: boolean;
  created_at: string;
  broker_connected: boolean;
  broker_name: string | null;
  broker_account_type: string | null;
  banned: boolean;
  role?: string | null;
};


function AdminPage() {
  const { isAdmin, loading: profileLoading } = useProfile();
  const [stats, setStats] = useState<ReferralRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mrrCents, setMrrCents] = useState(0);
  const [aiSpend30, setAiSpend30] = useState<number | null>(null);
  const [aiPerUser, setAiPerUser] = useState<
    Array<{ user_id: string; email: string | null; calls: number; graded_setups: number; cost_usd: number; cost_per_setup: number }>
  >([]);
  const [usageToday, setUsageToday] = useState<Array<{ user_id: string; requests: number; screenshots: number }>>([]);




  const changeRole = async (u: UserRow, role: "user" | "admin") => {
    if (role === (u.role ?? "user")) return;
    setBusyId(u.id);
    const { error } = await supabase.rpc("admin_set_user_role" as never, { _user_id: u.id, _role: role } as never);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${u.email ?? "User"} is now ${role}`);
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, role } : x)) ?? prev);
  };

  const toggleBan = async (u: UserRow) => {
    const next = !u.banned;
    if (next && !confirm(`Ban ${u.email}? They will be signed out and blocked from the app.`)) return;
    setBusyId(u.id);
    const { error } = await supabase.rpc("admin_set_banned" as never, { _user_id: u.id, _banned: next, _reason: null } as never);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(next ? "User banned" : "User unbanned");
    setUsers((prev) => prev?.map((x) => x.id === u.id ? { ...x, banned: next } : x) ?? prev);
  };



  useEffect(() => {
    (async () => {
      try {
        const [s, u] = await Promise.all([
          adminReferralStats(),
          adminUsersOverview(),
        ]);
        setStats((s ?? []) as ReferralRow[]);
        setUsers((u ?? []) as UserRow[]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    aiCostSummary({ data: { days: 30 } })
      .then((res) => {
        setAiSpend30(res.byKind.reduce((s, r) => s + Number(r.cost_usd), 0));
        setAiPerUser(res.byUser);
      })
      .catch(() => setAiSpend30(null));
    adminUsageToday()
      .then((rows) => setUsageToday(rows))
      .catch(() => setUsageToday([]));
  }, []);


  if (profileLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Admin gate temporarily disabled - panel visible to all users for testing.


  const totalUsers = users?.length ?? 0;
  const totalReferrals = stats?.reduce((a, r) => a + Number(r.count), 0) ?? 0;
  const maxCount = stats?.reduce((a, r) => Math.max(a, Number(r.count)), 0) ?? 0;
  const mrrUsd = mrrCents / 100;
  const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: n < 10 && n !== 0 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const aiByUser = new Map(aiPerUser.map((r) => [r.user_id, r]));
  const todayByUser = new Map(usageToday.map((r) => [r.user_id, r]));

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto space-y-6">
      <PageHeader title="Admin" description="Simple money view: what comes in, what AI costs, what you keep." />

      {err && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="text-xs text-muted-foreground">Money in, per month</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{usd(totals.gross || mrrUsd)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{totalUsers} accounts</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="text-xs text-muted-foreground">AI cost, this month</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{aiSpendMonth === null ? "-" : usd(aiSpendMonth)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">What you pay for the AI</div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="text-xs text-muted-foreground">Real profit</div>
          <div className={`mt-2 text-3xl font-semibold tabular-nums ${(totals.profit) < 0 ? "text-destructive" : "text-bull"}`}>
            {usd(totals.profit)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Money in minus AI cost</div>
        </div>
      </div>

      <CustomerMoneyTable users={users} aiSpend={aiPerUser} onTotals={setTotals} />

      <AiAveragesPanel userCount={totalUsers} />

      <RevenuePanel onMrrChange={setMrrCents} />


      <PlatformStatusEditor />

      <div>
        <a
          href="/admin/subscribers"
          className="inline-flex items-center gap-2 rounded-full border border-border/60 px-3.5 py-1.5 text-xs font-semibold hover:bg-muted"
        >
          View Stripe subscribers
        </a>
      </div>


      <section>
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground mb-3">How did you find us</h2>
        <div className="rounded-xl border border-border/60 bg-card divide-y divide-border">
          {stats === null ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : stats.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No data yet.</div>
          ) : (
            stats.map((r) => {
              const pct = totalReferrals ? Math.round((Number(r.count) / totalReferrals) * 100) : 0;
              const bar = maxCount ? (Number(r.count) / maxCount) * 100 : 0;
              return (
                <div key={r.source} className="p-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="font-medium">{r.source}</span>
                    <span className="tabular-nums text-muted-foreground">{r.count} · {pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${bar}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground mb-3">Users and AI usage, last 30 days</h2>
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs tracking-tight text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-right px-4 py-2 font-medium">AI calls</th>
                   <th className="text-right px-4 py-2 font-medium">AI cost</th>
                   <th className="text-right px-4 py-2 font-medium">Today</th>
                   <th className="text-right px-4 py-2 font-medium">Shots today</th>
                   <th className="text-left px-4 py-2 font-medium">Role</th>
                  <th className="text-left px-4 py-2 font-medium">Broker</th>

                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Joined</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users === null ? (
                  <tr><td colSpan={11} className="p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={11} className="p-6 text-muted-foreground">No users yet.</td></tr>

                ) : users.map((u) => (
                  <tr key={u.id} className={u.banned ? "bg-destructive/5" : ""}>
                    <td className="px-4 py-2.5">{u.display_name ?? <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{aiByUser.get(u.id)?.calls ?? 0}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {aiByUser.get(u.id) ? `$${Number(aiByUser.get(u.id)!.cost_usd).toFixed(2)}` : "$0.00"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {(u.role ?? "user") === "admin" ? "unlimited" : `${todayByUser.get(u.id)?.requests ?? 0}/100`}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {(u.role ?? "user") === "admin" ? "unlimited" : `${todayByUser.get(u.id)?.screenshots ?? 0}/5`}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={(u.role ?? "user") as string}
                        onChange={(e) => changeRole(u, e.target.value as "user" | "admin")}
                        disabled={busyId === u.id}
                        className="rounded-xl border border-border/60 bg-background px-2 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>

                    <td className="px-4 py-2.5">
                      {u.broker_connected ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${u.broker_account_type === "live" ? "bg-bull/10 text-bull border border-bull/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                          {u.broker_account_type === "live" ? <CircleDot className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
                          {u.broker_account_type === "live" ? "Live" : u.broker_account_type === "demo" ? "Demo" : u.broker_name ?? "Connected"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground bg-muted border border-border/60">
                          <CircleOff className="h-3 w-3" /> Not connected
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {u.banned ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-destructive/10 text-destructive border border-destructive/30">
                          <Ban className="h-3 w-3" /> Banned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-bull/10 text-bull border border-bull/20">
                          <ShieldCheck className="h-3 w-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{new Date(u.created_at).toLocaleDateString()}</td>

                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => toggleBan(u)}
                        disabled={busyId === u.id}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${u.banned ? "border-bull/30 text-bull hover:bg-bull/10" : "border-destructive/30 text-destructive hover:bg-destructive/10"}`}
                      >
                        {busyId === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : u.banned ? <ShieldCheck className="h-3 w-3" /> : <Ban className="h-3 w-3" />}
                        {u.banned ? "Unban" : "Ban"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <AiCreditsPanel />

      <SupportTicketsPanel />

      <AiCostPanel />
    </div>
  );
}

function AiCostPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Awaited<ReturnType<typeof aiCostSummary>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    aiCostSummary({ data: { days } })
      .then((res) => { if (!cancelled) { setData(res); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  const total = (data?.byKind ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  const cachedTokens = (data?.byKind ?? []).reduce((s, r) => s + Number(r.cached_input_tokens ?? 0), 0);
  const inputTokens = (data?.byKind ?? []).reduce((s, r) => s + Number(r.input_tokens ?? 0), 0);
  const cacheHitPct = inputTokens + cachedTokens > 0
    ? Math.round((cachedTokens / (inputTokens + cachedTokens)) * 100)
    : 0;
  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-muted-foreground" /> AI spend
        </h2>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-xl border px-2 py-1 text-[11px] ${d === days ? "border-foreground/40 bg-muted" : "border-border/60 text-muted-foreground"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 p-4">
          <div className="text-xs text-muted-foreground">Total spend, last {days} days</div>
          <div className="mt-2 text-2xl font-semibold">{usd(total)}</div>
        </div>
        <div className="rounded-xl border border-border/60 p-4">
          <div className="text-xs text-muted-foreground">Cache hit rate on input</div>
          <div className="mt-2 text-2xl font-semibold">{cacheHitPct}%</div>
        </div>
        <div className="rounded-xl border border-border/60 p-4">
          <div className="text-xs text-muted-foreground">Logged calls</div>
          <div className="mt-2 text-2xl font-semibold">
            {(data?.byKind ?? []).reduce((s, r) => s + Number(r.calls), 0)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">By call type and model</div>
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
          ) : (data?.byKind.length ?? 0) === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No AI calls logged yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="text-left px-3 py-2">Kind</th>
                  <th className="text-left px-3 py-2">Model</th>
                  <th className="text-right px-3 py-2">Calls</th>
                  <th className="text-right px-3 py-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data!.byKind.map((r, i) => (
                  <tr key={`${r.kind}-${r.model}-${i}`} className="border-b border-border/60">
                    <td className="px-3 py-2">{r.kind}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.model}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className="px-3 py-2 text-right">{usd(Number(r.cost_usd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">Per user, cost per graded setup</div>
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
          ) : (data?.byUser.length ?? 0) === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No usage attributed yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-right px-3 py-2">Setups</th>
                  <th className="text-right px-3 py-2">Spend</th>
                  <th className="text-right px-3 py-2">Per setup</th>
                </tr>
              </thead>
              <tbody>
                {data!.byUser.map((r, i) => (
                  <tr key={r.user_id ?? `anon-${i}`} className="border-b border-border/60">
                    <td className="px-3 py-2 truncate max-w-[180px]">{r.email ?? (r.user_id ? r.user_id.slice(0, 8) : "System")}</td>

                    <td className="px-3 py-2 text-right">{r.graded_setups}</td>
                    <td className="px-3 py-2 text-right">{usd(Number(r.cost_usd))}</td>
                    <td className="px-3 py-2 text-right">{Number(r.cost_per_setup) > 0 ? usd(Number(r.cost_per_setup)) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}


type StatusLevel = "operational" | "degraded" | "down";

const LEVEL_OPTIONS: { value: StatusLevel; label: string; cls: string }[] = [
  { value: "operational", label: "Operational", cls: "border-bull/40 text-bull bg-bull/10" },
  { value: "degraded",    label: "Degraded",    cls: "border-amber-500/40 text-amber-400 bg-amber-500/10" },
  { value: "down",        label: "Down",        cls: "border-red-500/40 text-red-400 bg-red-500/10" },
];

function PlatformStatusEditor() {
  const [level, setLevel] = useState<StatusLevel>("operational");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("platform_status" as never)
        .select("level,message,updated_at")
        .maybeSingle();
      if (!error && data) {
        const row = data as { level: StatusLevel; message: string; updated_at: string };
        setLevel(row.level);
        setMessage(row.message);
        setUpdatedAt(row.updated_at);
      }
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const row = await adminSetPlatformStatus({ data: { level, message } }) as { updated_at: string } | null;
      setSaving(false);
      toast.success("Platform status updated");
      if (row?.updated_at) setUpdatedAt(row.updated_at);
    } catch (e) {
      setSaving(false);
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">Platform status</h2>
          <p className="text-xs text-muted-foreground mt-1">Shown as a banner above every user's dashboard.</p>
        </div>
        {updatedAt && (
          <span className="text-[11px] text-muted-foreground">Updated {new Date(updatedAt).toLocaleString()}</span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {LEVEL_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setLevel(o.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  level === o.value ? o.cls : "border-border/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="Message shown to all users…"
          />
          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving || !message.trim()}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save status
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type CreditSnapshot = Awaited<ReturnType<typeof aiCreditsStatus>>;

function AiCreditsPanel() {
  const [snap, setSnap] = useState<CreditSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [threshold, setThreshold] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiCreditsStatus();
      setSnap(res);
      setBudget(String(res.monthlyBudgetUsd));
      setThreshold(String(res.lowThresholdPct));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await setAiBudget({
        data: { monthlyBudgetUsd: Number(budget), lowThresholdPct: Number(threshold) },
      });
      setSnap(res);
      toast.success("Budget saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const status = snap?.providerStatus ?? "unknown";
  const statusLabel: Record<string, string> = {
    ok: "Claude is accepting calls",
    out_of_credits: "Claude is out of credits, coach is on Google Gemini",
    not_configured: "Claude key is not configured",
    error: "Claude is erroring",
    unknown: "Not checked yet",
  };
  const low = (snap?.remainingPct ?? 100) <= (snap?.lowThresholdPct ?? 20);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <DollarSign className="h-4 w-4 text-muted-foreground" /> AI credits and provider health
        </h2>
        <button
          onClick={() => void load()}
          className="rounded-xl border border-border/60 px-2 py-1 text-[11px] text-muted-foreground"
        >
          Re-check now
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</div>
      )}

      {loading && !snap ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking Claude and month-to-date spend
        </div>
      ) : snap ? (
        <>
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              status === "ok"
                ? "border-border/60 text-muted-foreground"
                : "border-destructive/40 bg-destructive/5 text-destructive"
            }`}
          >
            {statusLabel[status] ?? status}
            {snap.providerMessage ? ` — ${snap.providerMessage}` : ""}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border/60 p-4">
              <div className="text-xs text-muted-foreground">Credits left this month</div>
              <div className={`mt-2 text-2xl font-semibold ${low ? "text-destructive" : ""}`}>{usd(snap.remainingUsd)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{snap.remainingPct}% of budget</div>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <div className="text-xs text-muted-foreground">Spent month to date</div>
              <div className="mt-2 text-2xl font-semibold">{usd(snap.monthToDateUsd)}</div>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <div className="text-xs text-muted-foreground">Last 24 hours</div>
              <div className="mt-2 text-2xl font-semibold">{usd(snap.todayUsd)}</div>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <div className="text-xs text-muted-foreground">Last 7 days</div>
              <div className="mt-2 text-2xl font-semibold">{usd(snap.last7dUsd)}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-border/60 p-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">Monthly budget, USD</span>
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-32 rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Warn at, percent left</span>
              <input
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-28 rounded-2xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
            </label>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save budget
            </button>
            <div className="text-[11px] text-muted-foreground">
              Checked {snap.checkedAt ? new Date(snap.checkedAt).toLocaleString() : "never"}. Admins get a notification
              when credits run low or Claude stops responding.
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

type TicketRow = Awaited<ReturnType<typeof adminListSupportRequests>>[number];

function SupportTicketsPanel() {
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminListSupportRequests()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium">Tickets and feedback</h2>
      {err && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</div>
      )}
      <div className="divide-y divide-border rounded-xl border border-border/60">
        {rows === null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </div>
        ) : rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nothing submitted yet.</div>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              onClick={() => setOpenId(openId === r.id ? null : r.id)}
              className="block w-full px-4 py-3 text-left hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{r.subject}</div>
                <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {r.kind === "ticket" ? "Ticket" : "Feedback"}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {r.reply_email} · {new Date(r.created_at).toLocaleString()} · {r.status.replace("_", " ")}
              </div>
              {openId === r.id && (
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{r.message}</div>
              )}
            </button>
          ))
        )}
      </div>
    </section>
  );
}
