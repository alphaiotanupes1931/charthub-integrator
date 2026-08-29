import { useState } from "react";
import { Ban, KeyRound, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type ManagedAccount = {
  id: string;
  email: string | null;
  role?: string | null;
  banned?: boolean;
  ai_model_pref?: string | null;
};

/**
 * Admin-only controls for one account: promote or demote to admin, pin the
 * coach model, ban or unban, force a new password, and hand back free grades.
 */
export function AccountControls({
  user,
  onChanged,
}: {
  user: ManagedAccount;
  onChanged?: (patch: Partial<ManagedAccount>) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const who = user.email ?? "This account";

  const run = async (
    key: string,
    fn: () => Promise<{ error: { message: string } | null }>,
    okMessage: string,
    patch?: Partial<ManagedAccount>,
  ) => {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(okMessage);
    if (patch) onChanged?.(patch);
  };

  const role = (user.role ?? "user") as "user" | "admin";
  const model = (user.ai_model_pref ?? "auto") as "auto" | "claude" | "fallback";
  const banned = !!user.banned;
  const month = new Date().toISOString().slice(0, 7);

  return (
    <div className="mt-5 rounded-2xl border border-border/60 bg-background p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Account controls
      </div>

      <label className="mt-3 block text-xs text-muted-foreground">
        Access level
        <select
          value={role}
          disabled={busy !== null}
          onChange={(e) => {
            const next = e.target.value as "user" | "admin";
            if (next === role) return;
            void run(
              "role",
              () =>
                supabase.rpc("admin_set_user_role" as never, { _user_id: user.id, _role: next } as never) as never,
              next === "admin" ? `${who} is now an admin` : `${who} is now a standard user`,
              { role: next },
            );
          }}
          className="mt-1 w-full rounded-xl border border-border/60 bg-card px-2.5 py-2 text-sm font-medium text-foreground disabled:opacity-50"
        >
          <option value="user">Standard user</option>
          <option value="admin">Admin (full access)</option>
        </select>
      </label>

      <label className="mt-3 block text-xs text-muted-foreground">
        Coach model
        <select
          value={model}
          disabled={busy !== null}
          onChange={(e) => {
            const next = e.target.value as "auto" | "claude" | "fallback";
            if (next === model) return;
            void run(
              "model",
              () =>
                supabase.rpc("admin_set_ai_model_pref" as never, { _user_id: user.id, _pref: next } as never) as never,
              `Coach model set to ${next === "auto" ? "automatic" : next === "claude" ? "Claude only" : "backup only"}`,
              { ai_model_pref: next },
            );
          }}
          className="mt-1 w-full rounded-xl border border-border/60 bg-card px-2.5 py-2 text-sm font-medium text-foreground disabled:opacity-50"
        >
          <option value="auto">Automatic</option>
          <option value="claude">Claude only</option>
          <option value="fallback">Backup only</option>
        </select>
      </label>

      <div className="mt-4 grid gap-2">
        <button
          disabled={busy !== null}
          onClick={() => {
            if (!banned && !confirm(`Ban ${who}? They lose access to the app right away.`)) return;
            void run(
              "ban",
              () =>
                supabase.rpc("admin_set_banned" as never, {
                  _user_id: user.id,
                  _banned: !banned,
                  _reason: null,
                } as never) as never,
              banned ? "Access restored" : "Account banned",
              { banned: !banned },
            );
          }}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
            banned
              ? "border-bull/30 text-bull hover:bg-bull/10"
              : "border-destructive/30 text-destructive hover:bg-destructive/10"
          }`}
        >
          {busy === "ban" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : banned ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <Ban className="h-3.5 w-3.5" />
          )}
          {banned ? "Restore access" : "Ban account"}
        </button>

        <button
          disabled={busy !== null}
          onClick={() =>
            void run(
              "pw",
              () =>
                supabase.rpc("admin_force_password_change" as never, {
                  _user_id: user.id,
                  _required: true,
                } as never) as never,
              "They will be asked to set a new password at next sign-in",
            )
          }
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {busy === "pw" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          Require a new password
        </button>

        <button
          disabled={busy !== null}
          onClick={() =>
            void run(
              "quota",
              () =>
                supabase.rpc("admin_reset_free_quota" as never, {
                  _user_id: user.id,
                  _month: month,
                } as never) as never,
              "Free grades for this month reset",
            )
          }
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {busy === "quota" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Reset free grades this month
        </button>
      </div>
    </div>
  );
}
