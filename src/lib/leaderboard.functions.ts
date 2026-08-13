import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const HANDLE_RE = /^[A-Za-z0-9_-]{2,24}$/;

export type LeaderboardRow = {
  handle: string;
  equity: number;
  starting_balance: number;
  pnl_pct: number;
  trades: number;
  wins: number;
  win_rate: number;
  updated_at: string;
};

export const getLeaderboard = createServerFn({ method: "GET" }).handler(async () => {
  // Public read via SECURITY DEFINER RPC — safe: returns only opted-in aggregates.
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data, error } = await supa.rpc("get_public_leaderboard", { _limit: 50 });
  if (error) throw new Error(error.message);
  return (data ?? []) as LeaderboardRow[];
});

export const getMyOptIn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("leaderboard_opt_in")
      .select("handle,opted_in,updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ?? null;
  });

export const setMyOptIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      handle: z.string().regex(HANDLE_RE, "Handle must be 2-24 letters, numbers, - or _"),
      opted_in: z.boolean(),
    }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leaderboard_opt_in")
      .upsert({ user_id: context.userId, handle: data.handle, opted_in: data.opted_in });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) throw new Error("That handle is already taken");
      throw new Error(error.message);
    }
    return { ok: true };
  });

/**
 * Compares the caller's current leaderboard rank against the last rank we
 * notified them about and drops an inbox notification when it moved. Called
 * from the leaderboard page after the board loads; deduped per rank so a
 * refresh cannot spam the inbox.
 */
export const checkMyLeaderboardRank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: optIn } = await context.supabase
      .from("leaderboard_opt_in")
      .select("handle,opted_in")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!optIn?.opted_in || !optIn.handle) return { rank: null as number | null, notified: false };

    const board = await getLeaderboard();
    const idx = board.findIndex((r) => r.handle === optIn.handle);
    if (idx < 0) return { rank: null as number | null, notified: false };
    const rank = idx + 1;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prior } = await supabaseAdmin
      .from("notifications")
      .select("meta")
      .eq("user_id", context.userId)
      .eq("kind", "info")
      .like("meta->>dedupe", "leaderboard:rank:%")
      .order("created_at", { ascending: false })
      .limit(1);
    const priorRank = Number((prior?.[0]?.meta as { rank?: number } | null)?.rank ?? 0) || null;
    if (priorRank === rank) return { rank, notified: false };

    const { createNotificationOnce } = await import("@/lib/notifications.server");
    const moved =
      priorRank == null
        ? `You're #${rank} on the leaderboard.`
        : rank < priorRank
          ? `You moved up from #${priorRank} to #${rank}.`
          : `You slipped from #${priorRank} to #${rank}.`;
    const created = await createNotificationOnce(
      `leaderboard:rank:${rank}`,
      {
        userId: context.userId,
        kind: "info",
        title: rank <= 3 ? `Top ${rank} on the leaderboard` : `Leaderboard rank: #${rank}`,
        body: moved,
        url: "/leaderboard",
        meta: { rank },
      },
      24,
    );
    return { rank, notified: !!created };
  });
