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
        apiKey: z.string().trim().min(20, "That token looks too short"),
        accountId: z.string().trim().optional(),
        env: z.enum(["practice", "live"]).optional(),
        makeActive: z.boolean().default(true),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { encryptSecret } = await import("@/lib/broker-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Auto-detect which OANDA environment the token belongs to and which
    // account it authorizes, so the trader only has to paste one value.
    async function discover(env: "practice" | "live") {
      const host = env === "live" ? "api-fxtrade.oanda.com" : "api-fxpractice.oanda.com";
      try {
        const res = await fetch(`https://${host}/v3/accounts`, {
          headers: { Authorization: `Bearer ${data.apiKey}`, "Content-Type": "application/json" },
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { accounts?: Array<{ id?: string }> };
        const id = json.accounts?.[0]?.id;
        return id ? { env, accountId: id } : null;
      } catch {
        return null;
      }
    }

    const order: Array<"practice" | "live"> = data.env === "live" ? ["live", "practice"] : ["practice", "live"];
    let found: { env: "practice" | "live"; accountId: string } | null = null;
    for (const env of order) {
      found = await discover(env);
      if (found) break;
    }
    if (!found && data.accountId && data.env) found = { env: data.env, accountId: data.accountId };
    if (!found) {
      throw new Error(
        "That token was not accepted by OANDA. Copy a fresh personal access token and try again.",
      );
    }

    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .upsert(
        {
          user_id: context.userId,
          broker: "oanda",
          api_key_ciphertext: encryptSecret(data.apiKey),
          account_id: found.accountId,
          env: found.env,
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
        .neq("env", found.env);
    }
    return { ok: true, env: found.env, accountId: found.accountId };
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
