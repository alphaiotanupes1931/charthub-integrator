import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(255);

const signInSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1).max(72),
});

const resetSchema = z.object({
  identifier: identifierSchema,
  redirectTo: z.string().url().max(500),
});

/** Resolve a username (or email) to the account email, server-side only. */
async function resolveEmail(identifier: string): Promise<string | null> {
  const value = identifier.trim();
  if (value.includes("@")) return value.toLowerCase();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email,username")
    .ilike("username", value)
    .limit(1)
    .maybeSingle();
  return data?.email ?? null;
}

/**
 * Sign in with either a username or an email. The password is always verified
 * by Supabase Auth; the username is only ever resolved on the server so account
 * emails are never exposed to the browser.
 */
export const signInWithIdentifier = createServerFn({ method: "POST" })
  .inputValidator((data) => signInSchema.parse(data))
  .handler(async ({ data }) => {
    const email = await resolveEmail(data.identifier);
    if (!email) throw new Error("Incorrect username or password. Please try again.");

    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signedIn, error } = await client.auth.signInWithPassword({ email, password: data.password });
    if (error || !signedIn.session) {
      throw new Error("Incorrect username or password. Please try again.");
    }
    return {
      access_token: signedIn.session.access_token,
      refresh_token: signedIn.session.refresh_token,
    };
  });

/**
 * Instagram-style reset request: always reports success so the form can never be
 * used to probe which usernames or emails exist.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data) => resetSchema.parse(data))
  .handler(async ({ data }) => {
    const email = await resolveEmail(data.identifier);
    if (!email) return { ok: true };
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(
        process.env["SUPABASE_URL"]!,
        process.env["SUPABASE_PUBLISHABLE_KEY"]!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      await client.auth.resetPasswordForEmail(email, { redirectTo: data.redirectTo });
    } catch {
      /* never leak delivery failures back to the form */
    }
    return { ok: true };
  });
