// Which coach model a single chat request should use.
//
// Kept as one pure function so the routing rules (per-account pin, stored key,
// live Claude health) are testable without touching the network or the database.

export type ModelPref = "auto" | "claude" | "fallback";

export type ChatRoute = {
  useClaude: boolean;
  /** Why this route was chosen — logged and surfaced in diagnostics. */
  reason:
    | "pinned_claude"
    | "pinned_fallback"
    | "auto_healthy"
    | "auto_unhealthy"
    | "no_key";
};

export function normalizeModelPref(raw: unknown): ModelPref {
  return raw === "claude" || raw === "fallback" ? raw : "auto";
}

export function resolveChatModel(input: {
  pref: ModelPref;
  hasKey: boolean;
  claudeHealthy: boolean;
}): ChatRoute {
  const { pref, hasKey, claudeHealthy } = input;
  if (pref === "fallback") return { useClaude: false, reason: "pinned_fallback" };
  if (!hasKey) return { useClaude: false, reason: "no_key" };
  // A pinned account uses Claude even if the health probe is unhappy, so one
  // flaky probe can't silently move that person onto the backup model.
  if (pref === "claude") return { useClaude: true, reason: "pinned_claude" };
  return claudeHealthy
    ? { useClaude: true, reason: "auto_healthy" }
    : { useClaude: false, reason: "auto_unhealthy" };
}
