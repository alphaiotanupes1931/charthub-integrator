import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function makeCode() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

export const createInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { note?: string }) => data)
  .handler(async ({ data, context }) => {
    const code = makeCode();
    const { data: row, error } = await context.supabase
      .from("trader_invites")
      .insert({ inviter_id: context.userId, code, note: data.note ?? null })
      .select("id,code,note,created_at,accepted_by")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMyInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trader_invites")
      .select("id,code,note,created_at,accepted_by,accepted_at")
      .eq("inviter_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trader_invites")
      .delete()
      .eq("id", data.id)
      .eq("inviter_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => data)
  .handler(async ({ data, context }) => {
    const code = data.code.trim();
    const { data: invite, error } = await context.supabase
      .from("trader_invites")
      .select("id,inviter_id,accepted_by")
      .eq("code", code)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invite) throw new Error("Invite not found");
    if (invite.inviter_id === context.userId) throw new Error("That's your own invite link");

    // mark accepted (only if not yet)
    if (!invite.accepted_by) {
      await context.supabase
        .from("trader_invites")
        .update({ accepted_by: context.userId, accepted_at: new Date().toISOString() })
        .eq("id", invite.id);
    }

    // create connection with sorted ids
    const [a, b] = [invite.inviter_id, context.userId].sort();
    const { error: connErr } = await context.supabase
      .from("trader_connections")
      .upsert({ user_a: a, user_b: b }, { onConflict: "user_a,user_b" });
    if (connErr) throw new Error(connErr.message);

    return { ok: true, inviterId: invite.inviter_id };
  });

export const listRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: conns, error } = await context.supabase
      .from("trader_connections")
      .select("user_a,user_b,created_at");
    if (error) throw new Error(error.message);
    const ids = (conns ?? [])
      .map((c) => (c.user_a === context.userId ? c.user_b : c.user_a))
      .filter((x) => x && x !== context.userId);
    if (ids.length === 0) return [];
    const { data: profs, error: pErr } = await context.supabase
      .from("profiles")
      .select("id,display_name,email,wins,losses")
      .in("id", ids);
    if (pErr) throw new Error(pErr.message);
    return (profs ?? []).map((p) => {
      const total = (p.wins ?? 0) + (p.losses ?? 0);
      const winRate = total > 0 ? Math.round(((p.wins ?? 0) / total) * 100) : 0;
      return { ...p, total, winRate };
    });
  });

export const updateMyStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { wins: number; losses: number }) => data)
  .handler(async ({ data, context }) => {
    const wins = Math.max(0, Math.floor(data.wins));
    const losses = Math.max(0, Math.floor(data.losses));
    const { error } = await context.supabase
      .from("profiles")
      .update({ wins, losses })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, wins, losses };
  });

export const updateVoicePrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { voice_enabled?: boolean; voice_id_override?: string | null }) => data)
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (typeof data.voice_enabled === "boolean") patch.voice_enabled = data.voice_enabled;
    if (data.voice_id_override !== undefined) patch.voice_id_override = data.voice_id_override;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("profiles")
      .update(patch)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
