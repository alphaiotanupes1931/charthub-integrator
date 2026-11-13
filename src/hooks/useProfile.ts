import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  referral_source: string | null;
  onboarded: boolean;
};

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async function refresh(): Promise<void> {
    setLoading(true);
    const { data: u, error: authError } = await supabase.auth.getUser();
    if (!u.user) {
      setProfile(null); setIsAdmin(false); setLoading(false);
      // An expired or revoked sign-in leaves a stale local session: the app
      // looks signed in but every data read fails. Clear it and send the
      // trader back to sign in so their account and data load again.
      // Only clear a session the server truly rejected. A missing session
      // right after sign-in or a network blip must never sign the trader out.
      const status = (authError as { status?: number } | null)?.status;
      const { data: local } = await supabase.auth.getSession();
      if (local.session && authError && (status === 401 || status === 403)) {
        await new Promise((r) => setTimeout(r, 1500));
        const retry = await supabase.auth.getUser();
        if (retry.data.user) { void refresh(); return; }
        const rs = (retry.error as { status?: number } | null)?.status;
        if (rs !== 401 && rs !== 403) return;
        try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
          window.location.assign(`/auth?mode=signin&reason=expired&redirect=${encodeURIComponent(window.location.pathname)}`);
        }
      }
      return;
    }
    const [{ data: p }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id,email,display_name,referral_source,onboarded").eq("id", u.user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", u.user.id),
    ]);
    setProfile(p as Profile | null);
    setIsAdmin(!!roles?.some((r) => r.role === "admin"));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { profile, isAdmin, loading, refresh };
}
