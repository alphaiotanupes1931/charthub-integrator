// Server-side capability enforcement, shared by every gated server function.
//
// The UI gate (CapabilityGate) only hides pages. The RPC endpoint behind a
// server function stays directly callable, so the paid surface has to be
// enforced here too — otherwise a free account can fetch Analytics, Autopilot,
// Signals or broker data by calling the endpoint straight.
//
// Pure functions only: no network, no database, so the rules are testable and
// the failure shape can't drift.
import { can, type Capability, type Entitlements } from "@/lib/entitlements";

/** Body returned to a caller that lacks the capability. Carries no user data. */
export type ForbiddenBody = {
  error: "forbidden";
  capability: Capability;
  upgradeRequired: true;
};

/** Body returned when there is no valid session at all. */
export type UnauthorizedBody = { error: "unauthorized" };

export function forbiddenBody(capability: Capability): ForbiddenBody {
  return { error: "forbidden", capability, upgradeRequired: true };
}

/**
 * 403 with a minimal JSON body. Deliberately never includes the resolved
 * entitlements, tier internals, or any part of the payload the caller wanted.
 */
export function forbiddenResponse(capability: Capability): Response {
  return new Response(JSON.stringify(forbiddenBody(capability)), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" } satisfies UnauthorizedBody), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** Throws a 403 Response when the account can't use the capability. */
export function assertCapability(ent: Entitlements, capability: Capability): void {
  if (!can(ent, capability)) throw forbiddenResponse(capability);
}

/** Keys that must never appear in a denial body (regression guard for tests). */
export const FORBIDDEN_BODY_ALLOWED_KEYS = ["error", "capability", "upgradeRequired"] as const;
