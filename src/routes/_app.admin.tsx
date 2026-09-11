import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { Loader2, CircleDot, CircleOff, CircleDashed, Ban, ShieldCheck, DollarSign, Send } from "lucide-react";
import { toast } from "sonner";
import { adminUsersOverview, adminSetPlatformStatus } from "@/lib/admin.functions";
import { aiCostSummary } from "@/lib/ai-cost.functions";
import { aiCreditsStatus } from "@/lib/ai-credits.functions";
import { adminListSupportRequests } from "@/lib/support.functions";
import { StripeSubscriptionsPanel } from "@/components/admin/StripeSubscriptionsPanel";
import { CustomerMoneyTable } from "@/components/admin/CustomerMoneyTable";
import { AiAveragesPanel } from "@/components/admin/AiAveragesPanel";

import { ImageUsagePanel } from "@/components/admin/ImageUsagePanel";
import { DateRangeSelector, monthToDateRange, type AdminRange } from "@/components/admin/DateRangeSelector";
import { UserUsageDrawer } from "@/components/admin/UserUsageDrawer";
import { TestChecklistPanel } from "@/components/admin/TestChecklistPanel";
import { InstrumentProfilePanel } from "@/components/admin/InstrumentProfilePanel";
import EngineReplayPanel from "@/components/EngineReplayPanel";

import { PlanDebugPanel } from "@/components/admin/PlanDebugPanel";
import { ScannerGovernancePanel } from "@/components/admin/ScannerGovernancePanel";
import { PaperBotPanel } from "@/components/admin/PaperBotPanel";



export const Route = createFileRoute("/_app/admin")({
  head: () => ({ meta: [{ title: "Admin, TradeMind" }] }),
  component: AdminPage,
});

type AdminTab = "profit" | "ai" | "image" | "people" | "methodology" | "paper" | "checks";

const ADMIN_TABS: { value: AdminTab; label: string }[] = [
  { value: "profit", label: "Profit" },
  { value: "ai", label: "AI usage" },
  { value: "image", label: "Image usage" },
  { value: "people", label: "People and settings" },
  { value: "methodology", label: "Scanner methodology" },
  { value: "paper", label: "Paper testing" },
];

// Only admins get the QA checklist tab.
const CHECKS_TAB: { value: AdminTab; label: string } = { value: "checks", label: "Test checklist" };

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
  ai_model_pref?: string | null;

};


function AdminPage() {
  const { isAdmin, loading: profileLoading } = useProfile();
  const [stats, setStats] = useState<ReferralRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stripeMrrCents, setStripeMrrCents] = useState(0);
  const [aiPerUser, setAiPerUser] = useState<
    Array<{ user_id: string; email: string | null; calls: number; graded_setups: number; cost_usd: number; cost_per_setup: number }>
  >([]);
  const [totals, setTotals] = useState({ gross: 0, aiCost: 0, profit: 0 });
  const [aiSpendMonth, setAiSpendMonth] = useState<number | null>(null);
  const [tab, setTab] = useState<AdminTab>("profit");
  const [detailUser, setDetailUser] = useState<UserRow | null>(null);
  // Money window for the Profit tab: defaults to this calendar month so far.
  const [profitRange, setProfitRange] = useState<AdminRange>(monthToDateRange());




  const changeRole = async (u: UserRow, role: "user" | "admin") => {
    if (role === (u.role ?? "user")) return;
    setBusyId(u.id);
    const { error } = await supabase.rpc("admin_set_user_role" as never, { _user_id: u.id, _role: role } as never);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${u.email ?? "User"} is now ${role}`);
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, role } : x)) ?? prev);
  };

  // Pin one account's coach model without touching anyone else.
  const changeModel = async (u: UserRow, pref: "auto" | "claude" | "fallback") => {
    if (pref === (u.ai_model_pref ?? "auto")) return;
    setBusyId(u.id);
    const { error } = await supabase.rpc("admin_set_ai_model_pref" as never, { _user_id: u.id, _pref: pref } as never);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(
      pref === "claude"
        ? `${u.email ?? "User"} is pinned to Claude`
        : pref === "fallback"
          ? `${u.email ?? "User"} is pinned to the backup model`
          : `${u.email ?? "User"} is back on automatic routing`,
    );
    setUsers((prev) => prev?.map((x) => (x.id === u.id ? { ...x, ai_model_pref: pref } : x)) ?? prev);
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
    if (profileLoading || !isAdmin) return;
    (async () => {
      try {
        const u = ((await adminUsersOverview()) ?? []) as UserRow[];
        setUsers(u);
        // Derive the signup-source breakdown straight from the user list so it
        // never disagrees with the people table.
        const tally = new Map<string, number>();
        for (const row of u) {
          const key = (row.referral_source ?? "").trim() || "Not answered";
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
        setStats(
          Array.from(tally, ([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [isAdmin, profileLoading]);

  // AI spend for the selected money window (defaults to month to date).
  useEffect(() => {
    if (profileLoading || !isAdmin) return;
    let cancelled = false;
    aiCostSummary({ data: { days: profitRange.days } })
      .then((res) => {
        if (cancelled) return;
        setAiSpendMonth(res.byKind.reduce((s, r) => s + Number(r.cost_usd), 0));
        setAiPerUser(res.byUser);
      })
      .catch(() => { if (!cancelled) setAiSpendMonth(null); });
    return () => { cancelled = true; };
  }, [isAdmin, profileLoading, profitRange.days]);


  if (profileLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/dashboard" replace />;


  const totalUsers = users?.length ?? 0;
  const totalReferrals = stats?.reduce((a, r) => a + Number(r.count), 0) ?? 0;
  const maxCount = stats?.reduce((a, r) => Math.max(a, Number(r.count)), 0) ?? 0;
  const stripeMrrUsd = stripeMrrCents / 100;
  const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: n < 10 && n !== 0 ? 2 : 0, maximumFractionDigits: 2 })}`;
  // One source of truth: money in from Stripe, AI cost = every logged
  // call this month (per-person plus system/background), profit is the difference.
  const grossMonth = stripeMrrUsd;
  const aiCostMonth = aiSpendMonth === null ? null : Math.max(aiSpendMonth, totals.aiCost);
  const realProfit = grossMonth - (aiCostMonth ?? totals.aiCost);

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto space-y-6">
      <PageHeader title="Admin" description="Simple money view: what comes in, what AI costs, what you keep." />

      {err && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-3">
        {(isAdmin ? [...ADMIN_TABS, CHECKS_TAB] : ADMIN_TABS).map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${tab === t.value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profit" && (
      <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">Money window: {profitRange.label}</div>
        <DateRangeSelector value={profitRange} onChange={setProfitRange} showGrouping={false} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="text-xs text-muted-foreground">Money in, per month</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{usd(grossMonth)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
Live from Stripe, {totalUsers} accounts
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="text-xs text-muted-foreground">AI cost, {profitRange.label}</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{aiCostMonth === null ? "-" : usd(aiCostMonth)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {aiCostMonth === null
              ? "Chat plus chart screenshot reads"
              : `${usd(totals.aiCost)} tied to people, ${usd(Math.max(0, aiCostMonth - totals.aiCost))} system and background`}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="text-xs text-muted-foreground">Real profit</div>
          <div className={`mt-2 text-3xl font-semibold tabular-nums ${realProfit < 0 ? "text-destructive" : "text-bull"}`}>
            {usd(realProfit)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {usd(grossMonth)} in minus {aiCostMonth === null ? "-" : usd(aiCostMonth)} AI
          </div>
        </div>
      </div>


      <CustomerMoneyTable users={users} aiSpend={aiPerUser} onTotals={setTotals} />

      <StripeSubscriptionsPanel onMrrChange={setStripeMrrCents} />

      </>
      )}

      {tab === "ai" && (
      <>
        
        <AiAveragesPanel userCount={totalUsers} />
        <AiCreditsPanel />
      </>
      )}

      {tab === "image" && <ImageUsagePanel />}

      {tab === "methodology" && <ScannerGovernancePanel />}

      {tab === "paper" && <PaperBotPanel />}

      {tab === "checks" && isAdmin && (
        <>
          <PlanDebugPanel />
          <InstrumentProfilePanel />
          <EngineReplayPanel canRefresh />

          <TestChecklistPanel />
        </>
      )}

      {tab === "people" && (
      <>
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
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground mb-3">People and access</h2>
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs tracking-tight text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                   <th className="text-left px-4 py-2 font-medium">Role</th>
                  <th className="text-left px-4 py-2 font-medium">AI model</th>
                  <th className="text-left px-4 py-2 font-medium">Broker</th>

                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Joined</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users === null ? (
                  <tr><td colSpan={8} className="p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-muted-foreground">No users yet.</td></tr>

                ) : users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setDetailUser(u)}
                    className={`cursor-pointer transition-colors hover:bg-muted/40 ${u.banned ? "bg-destructive/5" : ""}`}
                  >
                    <td className="px-4 py-2.5">

                      <span className="inline-flex items-center gap-2">
                        {u.display_name ?? <span className="text-muted-foreground">-</span>}
                        {(u.role ?? "user") === "admin" && (
                          <span className="rounded-full border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Admin
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>


                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>

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

                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={(u.ai_model_pref ?? "auto") as string}
                        onChange={(e) => changeModel(u, e.target.value as "auto" | "claude" | "fallback")}
                        disabled={busyId === u.id}
                        title="Which coach model this account uses"
                        className="rounded-xl border border-border/60 bg-background px-2 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        <option value="auto">Automatic</option>
                        <option value="claude">Claude only</option>
                        <option value="fallback">Backup only</option>
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

                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
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

      <SupportTicketsPanel />
      </>
      )}

      {detailUser && (
        <UserUsageDrawer
          user={detailUser}
          aiSpend={aiPerUser.find(
            (r) =>
              r.user_id === detailUser.id ||
              (!!r.email && !!detailUser.email && r.email.trim().toLowerCase() === detailUser.email.trim().toLowerCase()),
          )}
          onClose={() => setDetailUser(null)}
          onUserChanged={(patch) => {
            setDetailUser((prev) => (prev ? { ...prev, ...patch } : prev));
            setUsers((prev) => prev?.map((x) => (x.id === detailUser.id ? { ...x, ...patch } : x)) ?? prev);
          }}
        />
      )}


    </div>
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
  const [notify, setNotify] = useState(true);

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
      const res = await adminSetPlatformStatus({ data: { level, message, notifyUsers: notify } });
      const row = res?.row as { updated_at?: string } | null;
      setSaving(false);
      toast.success(
        notify
          ? `Status sent to ${res?.emailed ?? 0} ${(res?.emailed ?? 0) === 1 ? "person" : "people"}`
          : "Platform status updated",
      );
      if (row?.updated_at) setUpdatedAt(row.updated_at);
    } catch (e) {
      setSaving(false);
      toast.error(e instanceof Error ? e.message : "Failed to send");
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                className="h-4 w-4 rounded border-border/60 accent-primary"
              />
              Email every user a branded status update
            </label>
            <button
              onClick={save}
              disabled={saving || !message.trim()}
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send status
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
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await aiCreditsStatus();
      setSnap(res);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
  const status = snap?.providerStatus ?? "unknown";
  const statusLabel: Record<string, string> = {
    ok: "Claude is accepting calls",
    out_of_credits: "Claude is out of credits, coach is on Google Gemini",
    not_configured: "Claude key is not configured",
    error: "Claude is erroring",
    unknown: "Not checked yet",
  };

  const perDay = snap ? snap.monthToDateUsd / Math.max(1, new Date().getDate()) : 0;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <DollarSign className="h-4 w-4 text-muted-foreground" /> AI spend and provider health
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

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 p-4">
              <div className="text-xs text-muted-foreground">Spent this month</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{usd(snap.monthToDateUsd)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">about {usd(perDay)} per day so far</div>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <div className="text-xs text-muted-foreground">Last 24 hours</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{usd(snap.todayUsd)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">rolling one day</div>
            </div>
            <div className="rounded-xl border border-border/60 p-4">
              <div className="text-xs text-muted-foreground">Last 7 days</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{usd(snap.last7dUsd)}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">about {usd(snap.last7dUsd / 7)} per day</div>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            No platform budget is set. AI usage is paid out of customer revenue, so watch the per-person spend in the money
            table above to decide each user's monthly limit. Checked{" "}
            {snap.checkedAt ? new Date(snap.checkedAt).toLocaleString() : "never"}.
          </p>
        </>
      ) : null}
    </section>
  );
}

type TicketRow = Awaited<ReturnType<typeof adminListSupportRequests>>[number] & { sentiment?: string | null };

const SENTIMENTS: Record<string, { label: string; cls: string }> = {
  good: { label: "Good", cls: "border-bull/30 bg-bull/10 text-bull" },
  neutral: { label: "Okay", cls: "border-amber-500/30 bg-amber-500/10 text-amber-500" },
  bad: { label: "Bad", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
};

function SupportTicketsPanel() {
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "good" | "neutral" | "bad" | "ticket">("all");

  useEffect(() => {
    let cancelled = false;
    adminListSupportRequests()
      .then((r) => { if (!cancelled) setRows(r as TicketRow[]); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, []);

  const counts = {
    all: rows?.length ?? 0,
    good: rows?.filter((r) => r.sentiment === "good").length ?? 0,
    neutral: rows?.filter((r) => r.sentiment === "neutral").length ?? 0,
    bad: rows?.filter((r) => r.sentiment === "bad").length ?? 0,
    ticket: rows?.filter((r) => r.kind === "ticket").length ?? 0,
  };
  const visible = (rows ?? []).filter((r) =>
    filter === "all" ? true : filter === "ticket" ? r.kind === "ticket" : r.sentiment === filter,
  );

  const TABS: Array<{ id: typeof filter; label: string }> = [
    { id: "all", label: "All" },
    { id: "good", label: "Good" },
    { id: "neutral", label: "Okay" },
    { id: "bad", label: "Bad" },
    { id: "ticket", label: "Tickets" },
  ];

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Tickets and feedback</h2>
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                filter === t.id ? "border-foreground/40 bg-muted" : "border-border/60 text-muted-foreground"
              }`}
            >
              {t.label} {counts[t.id]}
            </button>
          ))}
        </div>
      </div>
      {err && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</div>
      )}

      <div className="divide-y divide-border rounded-xl border border-border/60">
        {rows === null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nothing here yet.</div>
        ) : (
          visible.map((r) => {
            const s = r.sentiment ? SENTIMENTS[r.sentiment] : null;
            return (
              <button
                key={r.id}
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                className="block w-full px-4 py-3 text-left hover:bg-muted/50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{r.subject}</div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {s && (
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
                    )}
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {r.kind === "ticket" ? "Ticket" : "Feedback"}
                    </span>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {r.reply_email} · {new Date(r.created_at).toLocaleString()} · {r.status.replace("_", " ")}
                </div>
                {openId === r.id && (
                  <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{r.message}</div>
                )}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
