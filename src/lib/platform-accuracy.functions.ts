import { createServerFn } from "@tanstack/react-start";
import { requireCapability } from "@/lib/capability-middleware";
import { z } from "zod";

const counts = z.object({ wins: z.number().nonnegative(), losses: z.number().nonnegative(), breakeven: z.number().nonnegative().optional(), updatedAt: z.string().nullable() });

/** Aggregate-only RPC; private trade rows never cross this boundary. */
export const getPlatformAccuracy = createServerFn({ method: "GET" })
  .middleware([requireCapability("signal_engine")])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("platform_accuracy_summary");
    if (error) throw new Error("Performance results unavailable");
    return z.object({ scans: counts, trades: counts }).parse(data);
  });