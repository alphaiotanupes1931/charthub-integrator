import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { strongPasswordSchema } from "@/lib/api-security";

const schema = z.object({
  email: z.string().email().max(255),
  password: strongPasswordSchema,
});

export const signUpConfirmed = createServerFn({ method: "POST" })
  .inputValidator((data) => schema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (error) {
      // surface a clean message
      throw new Error(error.message);
    }
    if (created.user) {
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
        id: created.user.id,
        email: created.user.email ?? data.email,
        display_name: (created.user.email ?? data.email).split("@")[0],
      });
      if (profileError) throw new Error(profileError.message);
    }
    return { ok: true };
  });
