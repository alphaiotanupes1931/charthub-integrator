// Autopilot audit log. Every automated decision the runner makes gets written
// here so a trader can reconstruct exactly why a trade was taken, blocked, or
// why the engine paused itself. Writes go through whichever client the caller
// already authorized (service role in the cron tick, user client in-app).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AutopilotEventKind =
  | "run"
  | "proposal"
  | "blocked"
  | "filled"
  | "failed"
  | "paused"
  | "resumed";

export async function logAutopilotEvent(
  client: SupabaseClient<Database>,
  userId: string,
  kind: AutopilotEventKind,
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await client.from("autopilot_events").insert({
      user_id: userId,
      kind,
      message,
      meta: meta as never,
    } as never);
  } catch {
    // The audit log must never break a run.
  }
}
