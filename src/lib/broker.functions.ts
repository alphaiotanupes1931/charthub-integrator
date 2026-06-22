import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RecordSchema = z.object({
  brokerName: z.string().min(1),
  accountType: z.enum(["live", "demo"]),
  connected: z.boolean(),
});

export const recordBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => RecordSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
        broker_connected: data.connected,
        broker_name: data.brokerName,
        broker_account_type: data.accountType,
      })
      .eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
