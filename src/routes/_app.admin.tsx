import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { Loader2, ShieldAlert, Users, BarChart3, CircleDot, CircleOff, CircleDashed } from "lucide-react";

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
};

function AdminPage() {
  const { isAdmin, loading: profileLoading } = useProfile();
  const [stats, setStats] = useState<ReferralRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const [{ data: s, error: e1 }, { data: u, error: e2 }] = await Promise.all([
        supabase.rpc("admin_referral_stats"),
        supabase.rpc("admin_users_overview"),
      ]);
      if (e1 || e2) { setErr(e1?.message ?? e2?.message ?? "Failed to load"); return; }
      setStats((s ?? []) as ReferralRow[]);
      setUsers((u ?? []) as UserRow[]);
    })();
  }, [isAdmin]);

  if (profileLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
        <PageHeader title="Admin" description="Restricted area." />
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-12 text-center">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive mb-3" />
          <p className="text-sm text-muted-foreground">This page is restricted to admin accounts.</p>
        </div>
      </div>
    );
  }

  const totalUsers = users?.length ?? 0;
  const totalReferrals = stats?.reduce((a, r) => a + Number(r.count), 0) ?? 0;
  const maxCount = stats?.reduce((a, r) => Math.max(a, Number(r.count)), 0) ?? 0;

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto space-y-8">
      <PageHeader title="Admin" description="User insights and acquisition stats." />

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{err}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Total users
          </div>
          <div className="mt-2 text-3xl font-semibold">{totalUsers}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" /> Sources tracked
          </div>
          <div className="mt-2 text-3xl font-semibold">{stats?.length ?? 0}</div>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">How did you find us</h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Users</h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-left px-4 py-2 font-medium">Source</th>
                  <th className="text-left px-4 py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users === null ? (
                  <tr><td colSpan={4} className="p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-muted-foreground">No users yet.</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2.5">{u.display_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.referral_source ?? <span className="opacity-60">—</span>}</td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
