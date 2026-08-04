import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CredsSchema = z.object({
  apiKey: z.string().trim().max(4000).optional(),
  apiSecret: z.string().trim().max(4000).optional(),
  passphrase: z.string().trim().max(1000).optional(),
  accountId: z.string().trim().max(200).optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
  token: z.string().trim().max(4000).optional(),
});

const SaveSchema = z.object({
  broker: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/),
  env: z.string().trim().max(20).default("practice"),
  creds: CredsSchema,
});

/** Non-sensitive metadata for every broker the user has connected. */
export const listBrokerConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_broker_credentials")
      .select("broker, account_id, env, updated_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      broker: row.broker as string,
      accountId: (row.account_id as string | null) ?? null,
      env: (row.env as string | null) ?? "practice",
      updatedAt: row.updated_at as string,
    }));
  });

/** Verify credentials against the broker, then store them encrypted at rest. */
export const saveBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { BROKER_BY_ID } = await import("@/lib/brokers/registry");
    const def = BROKER_BY_ID[data.broker];
    if (!def) throw new Error("Unknown broker");

    for (const field of def.fields) {
      if (field.optional) continue;
      const value = data.creds[field.key];
      if (!value || String(value).trim().length < 2) {
        throw new Error(`${field.label} is required for ${def.name}`);
      }
    }

    const { verifyBroker } = await import("@/lib/brokers/adapters.server");
    const result = def.testable
      ? await verifyBroker(data.broker, data.creds, data.env)
      : { ok: true, detail: "Stored. This broker has no cloud API to verify against." };
    if (!result.ok) {
      return { ok: false as const, detail: result.detail };
    }

    const { encryptSecret } = await import("@/lib/broker-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_broker_credentials").upsert(
      {
        user_id: context.userId,
        broker: data.broker,
        api_key_ciphertext: encryptSecret(JSON.stringify(data.creds)),
        account_id: data.creds.accountId?.trim() || result.accountLabel || null,
        env: data.env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,broker" },
    );
    if (error) throw new Error(error.message);

    await context.supabase
      .from("profiles")
      .update({
        broker_connected: true,
        broker_name: def.name,
        broker_account_type: data.env === "live" ? "live" : "demo",
      })
      .eq("id", context.userId);

    return { ok: true as const, detail: result.detail };
  });

/** Re-run the read-only verification call using stored credentials. */
export const testBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ broker: z.string().trim().min(2).max(40) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { BROKER_BY_ID } = await import("@/lib/brokers/registry");
    const def = BROKER_BY_ID[data.broker];
    if (!def) throw new Error("Unknown broker");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("user_broker_credentials")
      .select("api_key_ciphertext, env")
      .eq("user_id", context.userId)
      .eq("broker", data.broker)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { ok: false as const, detail: "No credentials saved for this broker." };
    if (!def.testable) {
      return { ok: true as const, detail: "Stored. This broker has no cloud API to verify against." };
    }

    const { decryptSecret } = await import("@/lib/broker-crypto.server");
    const plaintext = decryptSecret(row.api_key_ciphertext as string);
    let creds: Record<string, string>;
    try {
      creds = JSON.parse(plaintext) as Record<string, string>;
    } catch {
      // Legacy rows stored the raw OANDA token instead of a JSON blob.
      creds = { apiKey: plaintext };
    }

    const { verifyBroker } = await import("@/lib/brokers/adapters.server");
    const result = await verifyBroker(data.broker, creds, (row.env as string) ?? "practice");
    return { ok: result.ok, detail: result.detail };
  });

export const deleteBrokerConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ broker: z.string().trim().min(2).max(40) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .delete()
      .eq("user_id", context.userId)
      .eq("broker", data.broker);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
