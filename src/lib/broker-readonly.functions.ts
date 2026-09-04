import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BrokerSnapshotResult } from "@/lib/broker-readonly.server";

/**
 * Read-only account link. Any signed-in trader can see their own balance,
 * open positions and recent closes; nothing here can place or change an order,
 * so it is not behind the broker_live capability.
 */
export const getBrokerSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrokerSnapshotResult> => {
    const { buildBrokerSnapshots } = await import("@/lib/broker-readonly.server");
    return buildBrokerSnapshots(context.userId);
  });
