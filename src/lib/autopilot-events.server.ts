// Autopilot audit log. Every automated decision the runner makes gets written
// here so a trader can reconstruct exactly why a trade was taken, blocked, or
// why the engine paused itself. Rows are system-written (service role), and
// traders can only read their own.
export type AutopilotEventKind =
  | "run"
  | "proposal"
  | "blocked"
  | "filled"
  | "failed"
  | "paused"
  | "resumed";

export async function logAutopilotEvent(
  userId: string,
  kind: AutopilotEventKind,
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("autopilot_events").insert({
      user_id: userId,
      kind,
      message,
      meta: meta as never,
    } as never);
  } catch {
    // The audit log must never break a run.
  }
}
