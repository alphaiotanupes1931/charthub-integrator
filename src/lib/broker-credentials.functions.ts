import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Save OANDA credentials for the current user. API key is encrypted on the
// server before being written; the plaintext is never persisted or returned.
export const saveOandaCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey: z.string().trim().min(20, "API key looks too short"),
        accountId: z.string().trim().min(3, "Account ID is required"),
        env: z.enum(["practice", "live"]).default("practice"),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { encryptSecret } = await import("@/lib/broker-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .upsert(
        {
          user_id: context.userId,
          broker: "oanda",
          api_key_ciphertext: encryptSecret(data.apiKey),
          account_id: data.accountId,
          env: data.env,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,broker" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteOandaCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .delete()
      .eq("user_id", context.userId)
      .eq("broker", "oanda");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Returns non-sensitive metadata only. Never returns the API key.
export const getOandaCredentialsMeta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_broker_credentials")
      .select("account_id, env, updated_at")
      .eq("user_id", context.userId)
      .eq("broker", "oanda")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { configured: false as const };
    return {
      configured: true as const,
      accountId: data.account_id ?? null,
      env: data.env as "practice" | "live",
      updatedAt: data.updated_at as string,
    };
  });
