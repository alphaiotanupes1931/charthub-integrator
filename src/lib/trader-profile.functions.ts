import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recommend } from "@/lib/trader-profile/score";
import { COACHES } from "@/lib/trader-profile/config";

const answersSchema = z.record(z.string().max(40), z.string().max(40)).refine((o) => Object.keys(o).length <= 30);
const utmSchema = z.record(z.string().max(40), z.string().max(200)).optional().default({});
const codeSchema = z.string().regex(/^[a-z0-9]{8,24}$/);

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-3);
}

/** Public: stores quiz answers under a short code so they survive the trip to signup (any domain, Google sign-in). */
export const saveQuizDraft = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ answers: answersSchema, ref: z.string().max(64).nullish(), utm: utmSchema }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rec = recommend(data.answers);
    const code = newCode();
    const { error } = await supabaseAdmin.from("quiz_drafts").insert({
      code, answers: data.answers, trader_type: rec.type, ref: data.ref ?? null, utm: data.utm,
    });
    if (error) throw new Error("Couldn't save your answers");
    return { code, type: rec.type };
  });

/** Public: reads an unclaimed, unexpired draft. Only quiz answers, nothing personal. */
export const getQuizDraft = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: codeSchema }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("quiz_drafts")
      .select("answers,ref,utm,expires_at,claimed_by").eq("code", data.code).maybeSingle();
    if (!row || row.claimed_by || new Date(row.expires_at).getTime() < Date.now()) return null;
    return { answers: row.answers as Record<string, string>, ref: row.ref, utm: (row.utm ?? {}) as Record<string, string> };
  });

/** Public: email-only result capture. Saved here, then sent to GoHighLevel when it's configured. */
export const submitQuizLead = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    email: z.string().trim().email().max(255), answers: answersSchema, ref: z.string().max(64).nullish(), utm: utmSchema,
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rec = recommend(data.answers);
    const { data: lead, error } = await supabaseAdmin.from("quiz_leads").insert({
      email: data.email.toLowerCase(), trader_type: rec.type, answers: data.answers, ref: data.ref ?? null, utm: data.utm,
    }).select("id").single();
    if (error) throw new Error("Couldn't save your email");

    const apiKey = process.env["GHL_API_KEY"];
    const locationId = process.env["GHL_LOCATION_ID"];
    if (!apiKey || !locationId) {
      await supabaseAdmin.from("quiz_leads").update({ ghl_status: "not_configured" }).eq("id", lead.id);
      return { ok: true, type: rec.type };
    }
    const headers = { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28", "Content-Type": "application/json", Accept: "application/json" };
    try {
      const up = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
        method: "POST", headers, body: JSON.stringify({ email: data.email, locationId, source: "trader-type-quiz" }),
      });
      if (!up.ok) throw new Error(`upsert ${up.status}`);
      const j = (await up.json()) as { contact?: { id?: string } };
      const contactId = j.contact?.id;
      if (!contactId) throw new Error("no contact id");
      // Tags in a separate call so GHL tag-added workflows fire.
      const tag = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
        method: "POST", headers, body: JSON.stringify({ tags: ["quiz-taker", `quiz-${rec.type.replace(/_/g, "-")}`] }),
      });
      if (!tag.ok) throw new Error(`tags ${tag.status}`);
      await supabaseAdmin.from("quiz_leads").update({ ghl_status: "sent" }).eq("id", lead.id);
    } catch (e) {
      await supabaseAdmin.from("quiz_leads").update({ ghl_status: "failed", ghl_error: (e as Error).message.slice(0, 200) }).eq("id", lead.id);
    }
    return { ok: true, type: rec.type };
  });

export const getMyTraderProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: row }, { data: prof }] = await Promise.all([
      context.supabase.from("trader_profiles").select("trader_type,coach_tone,chosen_coach,recommended_coach,chosen_strategies,recommended_strategies,created_at")
        .eq("user_id", context.userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      context.supabase.from("profiles").select("trader_type_prompt_dismissed_at").eq("id", context.userId).maybeSingle(),
    ]);
    return { profile: row ?? null, promptDismissed: !!prof?.trader_type_prompt_dismissed_at };
  });

export const dismissTraderTypePrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase.from("profiles").update({ trader_type_prompt_dismissed_at: new Date().toISOString() }).eq("id", context.userId);
    return { ok: true };
  });

export const applyTraderSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    source: z.enum(["public_quiz", "onboarding", "self_select"]),
    answers: answersSchema,
    coach: z.enum(COACHES),
    strategies: z.array(z.string().max(80)).min(1).max(2),
    risk: z.object({ riskPct: z.number().min(0.1).max(2), maxDailyLossPct: z.number().min(0.5).max(10), minGrade: z.enum(["A", "B+"]) }),
    ref: z.string().max(64).nullish(),
    utm: utmSchema,
    draftCode: codeSchema.nullish(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const rec = recommend(data.answers);
    const accepted = data.coach === rec.coach
      && JSON.stringify(data.strategies) === JSON.stringify(rec.strategies)
      && JSON.stringify(data.risk) === JSON.stringify(rec.risk);
    const { error } = await context.supabase.from("trader_profiles").insert({
      user_id: context.userId, source: data.source, answers: data.answers,
      trader_type: rec.type, recommended_coach: rec.coach, coach_tone: rec.tone,
      recommended_strategies: rec.strategies, risk_defaults: rec.risk,
      chosen_coach: data.coach, chosen_strategies: data.strategies, chosen_risk: data.risk,
      accepted, ref: data.ref ?? null, utm: data.utm,
    });
    if (error) throw new Error(error.message);

    await context.supabase.from("profiles").update({ active_coach: data.coach, active_strategy: data.strategies[0] }).eq("id", context.userId);

    // Risk rails only; Autopilot mode is never touched. Autopilot's lowest grade is B, so B+ maps to B.
    await context.supabase.from("autopilot_settings").upsert({
      user_id: context.userId, risk_pct: data.risk.riskPct, max_daily_loss_pct: data.risk.maxDailyLossPct,
      min_grade: data.risk.minGrade === "B+" ? "B" : "A",
    }, { onConflict: "user_id" });

    if (data.draftCode) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("quiz_drafts").update({ claimed_by: context.userId, claimed_at: new Date().toISOString() })
        .eq("code", data.draftCode).is("claimed_by", null);
    }
    return { ok: true, accepted, type: rec.type };
  });
