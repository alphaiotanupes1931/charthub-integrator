import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

// Project-specific bearer middleware that refreshes the session before
// attaching the access token. The generated attachSupabaseAuth uses
// getSession(), which can return an expired token; getUser() forces a
// refresh/validation so server functions rarely see a stale bearer.
export const attachSupabaseBearer = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return next({ headers: {} });
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
