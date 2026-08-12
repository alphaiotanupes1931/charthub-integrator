import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Save OANDA credentials for the current user. API key is encrypted on the
// server before being written; the plaintext is never persisted or returned.
// One credential set is kept per environment, so a trader can hold a demo
// (practice) account and a live account side by side and switch between them.
export const saveOandaCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        apiKey: z.string().trim().min(20, "API key looks too short"),
        accountId: z.string().trim().min(3, "Account ID is required"),
        env: z.enum(["practice", "live"]).default("practice"),
        makeActive: z.boolean().default(true),
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
          is_active: data.makeActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,broker,env" },
      );
    if (error) throw new Error(error.message);

    if (data.makeActive) {
      await supabaseAdmin
        .from("user_broker_credentials")
        .update({ is_active: false })
        .eq("user_id", context.userId)
        .eq("broker", "oanda")
        .neq("env", data.env);
    }
    return { ok: true };
  });

/** Switch which saved OANDA account (demo or live) trades route to. */
export const setOandaActiveEnv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ env: z.enum(["practice", "live"]) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("user_broker_credentials")
      .select("id")
      .eq("user_id", context.userId)
      .eq("broker", "oanda")
      .eq("env", data.env)
      .maybeSingle();
    if (!row) {
      throw new Error(
        data.env === "practice"
          ? "No demo account saved yet. Add your OANDA practice token first."
          : "No live account saved yet. Add your OANDA live token first.",
      );
    }
    await supabaseAdmin
      .from("user_broker_credentials")
      .update({ is_active: false })
      .eq("user_id", context.userId)
      .eq("broker", "oanda");
    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .update({ is_active: true })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return { ok: true, env: data.env };
  });

export const deleteOandaCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ env: z.enum(["practice", "live"]).optional() }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("user_broker_credentials")
      .delete()
      .eq("user_id", context.userId)
      .eq("broker", "oanda");
    if (data.env) q = q.eq("env", data.env);
    const { error } = await q;
    if (error) throw new Error(error.message);

    // Keep exactly one account active when a set remains.
    const { data: rest } = await supabaseAdmin
      .from("user_broker_credentials")
      .select("id, is_active")
      .eq("user_id", context.userId)
      .eq("broker", "oanda");
    if ((rest ?? []).length > 0 && !(rest ?? []).some((r) => r.is_active)) {
      await supabaseAdmin
        .from("user_broker_credentials")
        .update({ is_active: true })
        .eq("id", rest![0].id);
    }
    return { ok: true };
  });

// Returns non-sensitive metadata only. Never returns the API key.
export const getOandaCredentialsMeta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_broker_credentials")
      .select("account_id, env, is_active, updated_at")
      .eq("user_id", context.userId)
      .eq("broker", "oanda");
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) return { configured: false as const, accounts: [] };
    const accounts = rows.map((r) => ({
      env: (r.env as "practice" | "live") ?? "practice",
      accountId: (r.account_id as string | null) ?? null,
      active: Boolean(r.is_active),
      updatedAt: r.updated_at as string,
    }));
    const active = accounts.find((a) => a.active) ?? accounts[0];
    return {
      configured: true as const,
      accounts,
      activeEnv: active.env,
      accountId: active.accountId,
      env: active.env,
      updatedAt: active.updatedAt,
    };
  });
