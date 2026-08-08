// Autopilot phase 3 runner. Shared by the in-app scan button and the scheduled
// tick so both paths enforce the same rails, the same daily loss cap, and the
// same auto-execution rules.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  DEFAULT_AUTOPILOT_SETTINGS,
  evaluateRails,
  type AutopilotSettings,
} from "@/lib/autopilot.shared";
import { buildProposalDraft } from "@/lib/autopilot.server";
import { logAutopilotEvent } from "@/lib/autopilot-events.server";
import { createNotification } from "@/lib/notifications.server";

type Client = SupabaseClient<Database>;

export type AutopilotRunResult = {
  scanned: number;
  created: number;
  blocked: number;
  executed: number;
  skipped: string[];
  haltedReason: string | null;
};

export function settingsFromRow(row: Record<string, unknown> | null): AutopilotSettings {
  if (!row) return { ...DEFAULT_AUTOPILOT_SETTINGS };
  return {
    mode: row.mode as AutopilotSettings["mode"],
    accountTarget: row.account_target as AutopilotSettings["accountTarget"],
    minGrade: row.min_grade as AutopilotSettings["minGrade"],
    riskPct: Number(row.risk_pct),
    maxOpenPositions: Number(row.max_open_positions),
    maxDailyLossPct: Number(row.max_daily_loss_pct),
    allowedSymbols: (row.allowed_symbols as string[] | null) ?? [],
    sessionWindows: (row.session_windows as string[] | null) ?? [],
    liveAcknowledged: Boolean(row.live_acknowledged_at),
    pausedReason: (row.paused_reason as string | null) ?? null,
  };
}

// Realised loss today as a percentage of the account's starting balance.
export async function dailyLossPct(client: Client, userId: string): Promise<{ pct: number; equity: number }> {
  const { data: account } = await client
    .from("paper_accounts")
    .select("balance, starting_balance")
    .eq("user_id", userId)
    .maybeSingle();
  const equity = account?.balance ? Number(account.balance) : 10_000;
  const base = account?.starting_balance ? Number(account.starting_balance) : equity || 10_000;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: closed } = await client
    .from("paper_trades")
    .select("pnl")
    .eq("user_id", userId)
    .gte("closed_at", dayStart.toISOString());
  const net = (closed ?? []).reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const pct = net < 0 && base > 0 ? (Math.abs(net) / base) * 100 : 0;
  return { pct: Math.round(pct * 100) / 100, equity };
}

export async function runAutopilotForUser(
  client: Client,
  userId: string,
  settings: AutopilotSettings,
  timeframe: string,
  apiKey: string,
): Promise<AutopilotRunResult> {
  const result: AutopilotRunResult = {
    scanned: 0,
    created: 0,
    blocked: 0,
    executed: 0,
    skipped: [],
    haltedReason: null,
  };

  const { pct, equity } = await dailyLossPct(client, userId);
  if (pct >= settings.maxDailyLossPct) {
    const reason = `Daily loss cap hit: down ${pct}% today against your ${settings.maxDailyLossPct}% limit. Autopilot is paused until tomorrow.`;
    await client
      .from("autopilot_settings")
      .upsert({ user_id: userId, paused_reason: reason } as never, { onConflict: "user_id" });
    result.haltedReason = reason;
    return result;
  }

  const symbols = settings.allowedSymbols.length
    ? settings.allowedSymbols.slice(0, 8)
    : DEFAULT_AUTOPILOT_SETTINGS.allowedSymbols;
  result.scanned = symbols.length;

  const { data: pending } = await client
    .from("autopilot_proposals")
    .select("symbol, expires_at")
    .eq("user_id", userId)
    .eq("status", "pending");
  const nowMs = Date.now();
  const waiting = new Set(
    (pending ?? [])
      .filter((p) => new Date(p.expires_at as string).getTime() > nowMs)
      .map((p) => p.symbol as string),
  );

  const { count } = await client
    .from("autopilot_proposals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["approved", "filled"]);
  let openPositions = count ?? 0;

  for (const symbol of symbols) {
    if (waiting.has(symbol)) {
      result.skipped.push(`${symbol}: already waiting for you`);
      continue;
    }
    try {
      const draft = await buildProposalDraft(apiKey, symbol, timeframe, settings, equity);
      if (!draft) {
        result.skipped.push(`${symbol}: no setup`);
        continue;
      }
      const verdict = evaluateRails(settings, {
        symbol,
        grade: draft.grade,
        openPositions,
        dailyLossPct: pct,
      });

      // Auto mode fills paper trades on its own. Live still waits for a tap so
      // no order reaches a real broker without a human in the loop.
      const autoFill =
        verdict.allowed && settings.mode === "auto" && settings.accountTarget === "paper" && draft.units !== null;

      const { data: inserted, error } = await client
        .from("autopilot_proposals")
        .insert({
          user_id: userId,
          symbol: draft.symbol,
          timeframe: draft.timeframe,
          side: draft.side,
          grade: draft.grade,
          confidence: draft.confidence,
          entry: draft.entry,
          stop_loss: draft.stopLoss,
          take_profit: draft.takeProfit,
          units: draft.units,
          risk_pct: settings.riskPct,
          order_type: "market",
          account_target: settings.accountTarget,
          reasoning: draft.reasoning,
          status: verdict.allowed ? (autoFill ? "approved" : "pending") : "blocked",
          rejection_reason: verdict.allowed ? null : verdict.reason,
          decided_at: autoFill ? new Date().toISOString() : null,
        } as never)
        .select("id")
        .single();
      if (error) {
        result.skipped.push(`${symbol}: could not be saved`);
        continue;
      }

      if (!verdict.allowed) {
        result.blocked += 1;
        continue;
      }
      result.created += 1;

      if (autoFill) {
        const size = Math.max(1, Math.floor(draft.units ?? 1));
        const { error: posError } = await client.from("paper_positions").insert({
          user_id: userId,
          symbol: draft.symbol,
          side: draft.side,
          size,
          entry: draft.entry,
          stop: draft.stopLoss,
          take_profit: draft.takeProfit,
          grade: draft.grade,
        } as never);
        if (posError) {
          await client
            .from("autopilot_proposals")
            .update({ status: "failed", rejection_reason: posError.message })
            .eq("id", inserted.id as string);
        } else {
          await client
            .from("autopilot_proposals")
            .update({ status: "filled" })
            .eq("id", inserted.id as string);
          result.executed += 1;
          openPositions += 1;
        }
      }
    } catch {
      result.skipped.push(`${symbol}: data unavailable`);
    }
  }

  return result;
}
