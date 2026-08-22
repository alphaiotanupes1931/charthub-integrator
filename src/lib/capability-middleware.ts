// Middleware factory that turns a capability into a hard server-side gate.
//
// Usage in a gated server function:
//   createServerFn({ method: "GET" }).middleware([requireCapability("analytics")])
//
// It composes requireSupabaseAuth, so an anonymous caller still fails auth
// first (401) and a signed-in free account fails the capability check (403).
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCapability, unauthorizedResponse } from "@/lib/capability-guard";
import { resolveEntitlements, type Capability, type Entitlements } from "@/lib/entitlements";

/** True when the header carries something shaped like a bearer JWT. */
export function isBearerJwt(header: string | null | undefined): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 && token.split(".").length === 3;
}

/**
 * Runs before requireSupabaseAuth so a missing/malformed token produces a real
 * 401 Response instead of a generic thrown Error (which surfaces as a 500).
 */
export const requireAuthOr401 = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!isBearerJwt(request?.headers?.get("authorization"))) throw unauthorizedResponse();
  return next();
});

/** Reads the flag, subscription and admin row for a user and resolves entitlements. */
export async function resolveEntitlementsForUser(userId: string): Promise<Entitlements> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: flag }, { data: subscription }, { data: adminRow }] = await Promise.all([
    supabaseAdmin.from("app_flags").select("enabled").eq("key", "free_tier_enabled").maybeSingle(),
    supabaseAdmin.from("subscriptions").select("status,tier,trial_end").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);

  return resolveEntitlements({
    flagEnabled: !!flag?.enabled,
    isAdmin: !!adminRow,
    subscription: subscription
      ? { status: subscription.status, tier: subscription.tier, trialEnd: subscription.trial_end }
      : null,
  });
}

export function requireCapability(capability: Capability) {
  return createMiddleware({ type: "function" })
    .middleware([requireSupabaseAuth])
    .server(async ({ next, context }) => {
      const entitlements = await resolveEntitlementsForUser(context.userId);
      assertCapability(entitlements, capability);
      return next({ context: { entitlements } });
    });
}
