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
