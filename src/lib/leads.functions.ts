// Growth funnel: public email capture for the free plan, feeding the drip
// sequence sent by /api/public/hooks/drip-emails.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const CaptureInput = z.object({
  email: z.string().trim().email().max(255),
  /** Where the address was typed: landing hero, final CTA, pricing, signup. */
  source: z.string().trim().max(40).default("landing"),
  /** Optional campaign tag from the URL. */
  ref: z.string().trim().max(80).nullable().optional(),
});

/**
 * Records an email address on the marketing list. Public on purpose: this is the
 * top of the free-plan funnel and runs before any account exists. Duplicates are
 * idempotent and never reset an existing drip position.
 */
export const captureLead = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => CaptureInput.parse(raw))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    const { data: existing } = await supabaseAdmin
      .from("marketing_leads")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existing) return { ok: true, created: false as const };

    const { error } = await supabaseAdmin.from("marketing_leads").insert({
      email,
      source: data.source || "landing",
      ref: data.ref ?? null,
    });
    // A race on the unique index means someone else just captured it.
    if (error && error.code !== "23505") throw new Error(error.message);
    return { ok: true, created: !error };
  });

/**
 * Links a lead row to the account created from that address, so the drip can
 * stop selling a signup that already happened.
 */
export const linkLeadToUser = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ email: z.string().trim().email().max(255), userId: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("marketing_leads")
      .update({ user_id: data.userId })
      .ilike("email", data.email.toLowerCase());
    return { ok: true };
  });
