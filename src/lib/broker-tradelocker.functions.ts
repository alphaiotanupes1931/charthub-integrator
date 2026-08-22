import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "@/lib/capability-middleware";

// TradeLocker supports a real credential login (email + password + server), so
// this is an actual "log in to your broker" flow rather than a pasted API token.

/** Log in to TradeLocker and, if it works, save the login (encrypted) for reuse. */
export const connectTradeLocker = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        email: z.string().trim().email("Enter the email you use on TradeLocker"),
        password: z.string().min(1, "Password is required").max(200),
        server: z.string().trim().min(1, "Server name is required").max(64),
        env: z.enum(["demo", "live"]).default("demo"),
        accountId: z.string().trim().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { tlLogin, tlAccounts } = await import("@/lib/broker-tradelocker.server");
    const token = await tlLogin(data);
    const accounts = await tlAccounts(data.env, token);
    if (accounts.length === 0) throw new Error("Login worked but no TradeLocker accounts are attached to it");

    const chosen =
      accounts.find((a) => String(a.id) === String(data.accountId) || String(a.accNum) === String(data.accountId)) ??
      accounts[0];

    const { encryptSecret } = await import("@/lib/broker-crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_broker_credentials").upsert(
      {
        user_id: context.userId,
        broker: "tradelocker",
        api_key_ciphertext: encryptSecret(
          JSON.stringify({ email: data.email, password: data.password, server: data.server }),
        ),
        account_id: String(chosen.id),
        env: data.env,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,broker,env" },
    );
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("user_broker_credentials")
      .update({ is_active: false })
      .eq("user_id", context.userId)
      .eq("broker", "tradelocker")
      .neq("env", data.env);

    return {
      ok: true as const,
      env: data.env,
      email: data.email,
      server: data.server,
      accountId: String(chosen.id),
      accounts: accounts.map((a) => ({
        id: String(a.id),
        accNum: a.accNum != null ? String(a.accNum) : null,
        name: a.name ?? null,
        balance: a.accountBalance ?? null,
        currency: a.currency ?? null,
        status: a.status ?? null,
      })),
    };
  });

/** Live view of the saved TradeLocker login: which account, which server, balances. */
export const getTradeLockerStatus = createServerFn({ method: "GET" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const { tlSession } = await import("@/lib/broker-tradelocker.server");
    try {
      const session = await tlSession(context.userId);
      if (!session) return { connected: false as const, reason: "No TradeLocker login saved yet." };
      return {
        connected: true as const,
        env: session.creds.env,
        email: session.creds.email,
        server: session.creds.server,
        activeAccountId: String(session.account?.id ?? ""),
        accounts: session.accounts.map((a) => ({
          id: String(a.id),
          accNum: a.accNum != null ? String(a.accNum) : null,
          name: a.name ?? null,
          balance: a.accountBalance ?? null,
          currency: a.currency ?? null,
          status: a.status ?? null,
        })),
      };
    } catch (e) {
      return { connected: false as const, reason: (e as Error).message };
    }
  });

/** Choose which TradeLocker account this login trades. */
export const setTradeLockerAccount = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .inputValidator((raw: unknown) => z.object({ accountId: z.string().trim().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .update({ account_id: data.accountId, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("broker", "tradelocker")
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    return { ok: true as const, accountId: data.accountId };
  });

/** Log out: delete the stored TradeLocker login. */
export const disconnectTradeLocker = createServerFn({ method: "POST" })
  .middleware([requireCapability("broker_live")])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_broker_credentials")
      .delete()
      .eq("user_id", context.userId)
      .eq("broker", "tradelocker");
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
