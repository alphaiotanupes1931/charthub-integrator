import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { Loader2, ShieldAlert, Users, BarChart3, CircleDot, CircleOff, CircleDashed, Ban, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

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
};

function AdminPage() {
  const { isAdmin, loading: profileLoading } = useProfile();
  const [stats, setStats] = useState<ReferralRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);


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
      const [{ data: s, error: e1 }, { data: u, error: e2 }] = await Promise.all([
        supabase.rpc("admin_referral_stats"),
        supabase.rpc("admin_users_overview"),
      ]);
      if (e1 || e2) { setErr(e1?.message ?? e2?.message ?? "Failed to load"); return; }
      setStats((s ?? []) as ReferralRow[]);
      setUsers((u ?? []) as UserRow[]);
    })();
  }, []);


  if (profileLoading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Admin gate temporarily disabled — panel visible to all users for testing.


  const totalUsers = users?.length ?? 0;
  const totalReferrals = stats?.reduce((a, r) => a + Number(r.count), 0) ?? 0;
  const maxCount = stats?.reduce((a, r) => Math.max(a, Number(r.count)), 0) ?? 0;

  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto space-y-8">
      <PageHeader title="Admin" description="User insights and acquisition stats." />

      <PlatformStatusEditor />

      <div>
        <a
          href="/admin/subscribers"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          View Stripe subscribers →
        </a>
      </div>

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
                  <th className="text-left px-4 py-2 font-medium">Broker</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Joined</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users === null ? (
                  <tr><td colSpan={7} className="p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-muted-foreground">No users yet.</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id} className={u.banned ? "bg-destructive/5" : ""}>
                    <td className="px-4 py-2.5">{u.display_name ?? <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.referral_source ?? <span className="opacity-60">-</span>}</td>
                    <td className="px-4 py-2.5">
                      {u.broker_connected ? (
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${u.broker_account_type === "live" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                          {u.broker_account_type === "live" ? <CircleDot className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
                          {u.broker_account_type === "live" ? "Live" : u.broker_account_type === "demo" ? "Demo" : u.broker_name ?? "Connected"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground bg-muted border border-border">
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
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <ShieldCheck className="h-3 w-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => toggleBan(u)}
                        disabled={busyId === u.id}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${u.banned ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" : "border-destructive/30 text-destructive hover:bg-destructive/10"}`}
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
    </div>
  );
}

type StatusLevel = "operational" | "degraded" | "down";

const LEVEL_OPTIONS: { value: StatusLevel; label: string; cls: string }[] = [
  { value: "operational", label: "Operational", cls: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" },
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
    const { data, error } = await supabase.rpc(
      "admin_set_platform_status" as never,
      { _level: level, _message: message } as never,
    );
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Platform status updated");
    const row = data as { updated_at: string } | null;
    if (row?.updated_at) setUpdatedAt(row.updated_at);
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Platform status</h2>
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
                  level === o.value ? o.cls : "border-border text-muted-foreground hover:bg-muted"
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
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="Message shown to all users…"
          />
          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving || !message.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
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
