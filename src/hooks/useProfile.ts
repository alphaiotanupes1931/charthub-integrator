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

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: u, error: authError } = await supabase.auth.getUser();
    if (!u.user) {
      setProfile(null); setIsAdmin(false); setLoading(false);
      // An expired or revoked sign-in leaves a stale local session: the app
      // looks signed in but every data read fails. Clear it and send the
      // trader back to sign in so their account and data load again.
      const status = (authError as { status?: number } | null)?.status;
      if (authError && (status === 400 || status === 401 || status === 403 || /refresh token|jwt|session/i.test(authError.message))) {
        try { await supabase.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
          window.location.assign(`/auth?mode=signin&redirect=${encodeURIComponent(window.location.pathname)}`);
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
