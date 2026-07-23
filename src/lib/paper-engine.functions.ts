// Paper trading server functions. Called from client (Testing page) and
// from the cron reconciler.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getLastPrice,
  evaluateExit,
  pnlFor,
  computeEquity,
  KILL_SWITCH_DRAWDOWN,
  type PaperPosition,
} from "@/lib/paper-engine.server";

const DEFAULT_START = 10_000;

type AccountRow = {
  user_id: string;
  starting_balance: number;
  balance: number;
  peak_equity: number;
  status: "active" | "paused_for_review" | "off";
  paused_reason: string | null;
  testing_mode: boolean;
};

async function ensureAccountRow(supabase: any, userId: string): Promise<AccountRow> {
  const { data } = await supabase.from("paper_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (data) return data as AccountRow;
  const { data: created, error } = await supabase
    .from("paper_accounts")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return created as AccountRow;
}

export const getPaperState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const account = await ensureAccountRow(supabase, userId);
    const [{ data: positions }, { data: trades }, { data: snapshots }] = await Promise.all([
      supabase.from("paper_positions").select("*").eq("user_id", userId).order("opened_at", { ascending: false }),
      supabase.from("paper_trades").select("*").eq("user_id", userId).order("closed_at", { ascending: false }).limit(100),
      supabase.from("paper_equity_snapshots").select("equity,taken_at").eq("user_id", userId).order("taken_at", { ascending: false }).limit(200),
    ]);
    return {
      account,
      positions: (positions ?? []) as PaperPosition[],
      trades: trades ?? [],
      snapshots: (snapshots ?? []).reverse(),
    };
  });

export const setTestingMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ enabled: z.boolean() }).parse(raw))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await ensureAccountRow(supabase, userId);
    const { error } = await supabase
      .from("paper_accounts")
      .update({ testing_mode: data.enabled })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetPaperAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ startingBalance: z.number().positive().max(10_000_000).optional() }).parse(raw))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const bal = data.startingBalance ?? DEFAULT_START;
    await ensureAccountRow(supabase, userId);
    await supabase.from("paper_positions").delete().eq("user_id", userId);
    await supabase.from("paper_trades").delete().eq("user_id", userId);
    await supabase.from("paper_equity_snapshots").delete().eq("user_id", userId);
    const { error } = await supabase
      .from("paper_accounts")
      .update({
        starting_balance: bal,
        balance: bal,
        peak_equity: bal,
        status: "active",
        paused_reason: null,
      })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resumePaperAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const account = await ensureAccountRow(supabase, userId);
    const { error } = await supabase
      .from("paper_accounts")
      .update({ status: "active", paused_reason: null, peak_equity: account.balance })
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const openInput = z.object({
  symbol: z.string().min(1).max(30),
  side: z.enum(["long", "short"]),
  size: z.number().positive().max(1_000_000),
  entry: z.number().positive().optional(),
  stop: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  grade: z.string().max(10).optional(),
});

export const openPaperPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => openInput.parse(raw))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const account = await ensureAccountRow(supabase, userId);
    if (account.status !== "active") throw new Error(`Account is ${account.status}. Resume it before opening trades.`);
    // Auto-fill entry with current market price when not provided (market order).
    let entry = data.entry;
    if (!entry || !Number.isFinite(entry)) {
      const mkt = await getLastPrice(data.symbol).catch(() => null);
      if (!mkt) throw new Error(`Could not fetch market price for ${data.symbol}. Enter a price manually.`);
      entry = mkt;
    }
    const { data: pos, error } = await supabase
      .from("paper_positions")
      .insert({
        user_id: userId,
        symbol: data.symbol,
        side: data.side,
        size: data.size,
        entry,
        stop: data.stop ?? null,
        take_profit: data.takeProfit ?? null,
        grade: data.grade ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { position: pos };
  });

export const closePaperPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: pos, error: getErr } = await supabase
      .from("paper_positions")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (getErr) throw new Error(getErr.message);
    if (!pos) throw new Error("Position not found");

    const price = (await getLastPrice(pos.symbol)) ?? pos.entry;
    const pnl = pnlFor(pos as PaperPosition, price);
    const account = await ensureAccountRow(supabase, userId);
    const newBal = Number(account.balance) + pnl;

    await supabase.from("paper_trades").insert({
      user_id: userId,
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entry: pos.entry,
      exit: price,
      stop: pos.stop,
      take_profit: pos.take_profit,
      pnl,
      reason: "manual",
      grade: pos.grade,
      opened_at: pos.opened_at,
    });
    await supabase.from("paper_positions").delete().eq("id", pos.id);
    await supabase.from("paper_accounts").update({
      balance: newBal,
      peak_equity: Math.max(Number(account.peak_equity), newBal),
    }).eq("user_id", userId);
    return { ok: true, pnl };
  });

// Reconcile all users. Called by cron with service-role. Not user-facing.
export async function reconcileAllPaperAccounts(): Promise<{ users: number; closed: number; killed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: accounts } = await supabaseAdmin
    .from("paper_accounts")
    .select("*")
    .eq("testing_mode", true)
    .eq("status", "active");
  if (!accounts?.length) return { users: 0, closed: 0, killed: 0 };

  let closed = 0;
  let killed = 0;

  for (const acc of accounts) {
    const { data: positions } = await supabaseAdmin
      .from("paper_positions")
      .select("*")
      .eq("user_id", acc.user_id);
    const list = (positions ?? []) as PaperPosition[];

    // Fetch prices for the symbols in play
    const symbols = Array.from(new Set(list.map(p => p.symbol)));
    const priceEntries = await Promise.all(symbols.map(async (s) => [s, await getLastPrice(s)] as const));
    const priceBySymbol: Record<string, number> = {};
    for (const [s, p] of priceEntries) if (p != null) priceBySymbol[s] = p;

    let balance = Number(acc.balance);

    // Check exits
    for (const pos of list) {
      const price = priceBySymbol[pos.symbol];
      if (price == null) continue;
      const exit = evaluateExit(pos, price);
      if (!exit) continue;
      const pnl = pnlFor(pos, exit.exit);
      balance += pnl;
      await supabaseAdmin.from("paper_trades").insert({
        user_id: acc.user_id,
        symbol: pos.symbol,
        side: pos.side,
        size: pos.size,
        entry: pos.entry,
        exit: exit.exit,
        stop: pos.stop,
        take_profit: pos.take_profit,
        pnl,
        reason: exit.reason,
        grade: pos.grade,
        opened_at: pos.opened_at,
      });
      await supabaseAdmin.from("paper_positions").delete().eq("id", pos.id);
      closed += 1;
    }

    // Recompute equity with any remaining open positions
    const { data: stillOpen } = await supabaseAdmin
      .from("paper_positions")
      .select("*")
      .eq("user_id", acc.user_id);
    const equity = computeEquity(balance, (stillOpen ?? []) as PaperPosition[], priceBySymbol);
    const peak = Math.max(Number(acc.peak_equity), equity);

    // Kill switch — 10% drawdown from peak
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    let status: AccountRow["status"] = "active";
    let paused_reason: string | null = null;
    if (drawdown >= KILL_SWITCH_DRAWDOWN) {
      // Close everything at last price
      for (const pos of (stillOpen ?? []) as PaperPosition[]) {
        const px = priceBySymbol[pos.symbol] ?? pos.entry;
        const pnl = pnlFor(pos, px);
        balance += pnl;
        await supabaseAdmin.from("paper_trades").insert({
          user_id: acc.user_id,
          symbol: pos.symbol,
          side: pos.side,
          size: pos.size,
          entry: pos.entry,
          exit: px,
          stop: pos.stop,
          take_profit: pos.take_profit,
          pnl,
          reason: "kill_switch",
          grade: pos.grade,
          opened_at: pos.opened_at,
        });
      }
      await supabaseAdmin.from("paper_positions").delete().eq("user_id", acc.user_id);
      status = "paused_for_review";
      paused_reason = `Equity dropped ${(drawdown * 100).toFixed(2)}% from peak ($${peak.toFixed(2)} → $${balance.toFixed(2)}). All positions closed. Review before resuming.`;
      // Post briefing
      await supabaseAdmin.from("briefings").insert({
        user_id: acc.user_id,
        kind: "kill_switch",
        title: "Kill switch triggered",
        body: paused_reason,
      });
      // Fan out to Discord (user's personal webhook + shared community feed).
      try {
        const { sendDiscordWebhook, sendDiscordShared, sendTelegramMessage } = await import("@/lib/briefings.server");
        const { data: notifPrefs } = await supabaseAdmin
          .from("briefing_prefs")
          .select("discord_webhook_url,telegram_chat_id")
          .eq("user_id", acc.user_id)
          .maybeSingle();
        const alert = `⚠ Kill switch triggered\n${paused_reason}`;
        if ((notifPrefs as any)?.discord_webhook_url) {
          await sendDiscordWebhook((notifPrefs as any).discord_webhook_url, alert).catch(() => undefined);
        }
        if ((notifPrefs as any)?.telegram_chat_id) {
          await sendTelegramMessage((notifPrefs as any).telegram_chat_id, alert).catch(() => undefined);
        }
        await sendDiscordShared(`Kill switch triggered for a paper account (${(drawdown * 100).toFixed(1)}% drawdown). All positions flat.`).catch(() => undefined);
      } catch { /* best effort */ }
      killed += 1;
    }

    await supabaseAdmin.from("paper_accounts").update({
      balance,
      peak_equity: peak,
      status,
      paused_reason,
    }).eq("user_id", acc.user_id);

    await supabaseAdmin.from("paper_equity_snapshots").insert({
      user_id: acc.user_id,
      equity: status === "paused_for_review" ? balance : equity,
    });
  }

  return { users: accounts.length, closed, killed };
}
