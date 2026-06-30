import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export const setRecoveryCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ code: z.string().min(8).max(64) }).parse(data))
  .handler(async ({ data, context }) => {
    const hash = hashCode(data.code);
    const { error } = await context.supabase
      .from("profiles")
      .update({ recovery_code_hash: hash })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const redeemRecoveryCode = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z.object({
      email: z.string().trim().email().max(255),
      code: z.string().trim().min(8).max(64),
      redirectTo: z.string().url(),
    }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const hash = hashCode(data.code);

    // Look up the profile by email + matching hash. Generic error to avoid
    // leaking whether the email exists.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id,email,recovery_code_hash")
      .eq("email", data.email.toLowerCase())
      .maybeSingle();

    if (!profile || !profile.recovery_code_hash || profile.recovery_code_hash !== hash) {
      throw new Error("That email and recovery code don't match. Double-check both.");
    }

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email.toLowerCase(),
      options: { redirectTo: data.redirectTo },
    });
    if (error || !link.properties?.action_link) {
      throw new Error(error?.message ?? "Could not start password reset");
    }
    return { actionLink: link.properties.action_link };
  });
