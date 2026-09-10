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
    minGrade: row.min_grade as AutopilotSettings["minGrade"],
    riskPct: Number(row.risk_pct),
    maxOpenPositions: Number(row.max_open_positions),
    maxDailyLossPct: Number(row.max_daily_loss_pct),
    allowedSymbols: (row.allowed_symbols as string[] | null) ?? [],
    sessionWindows: (row.session_windows as string[] | null) ?? [],
    liveAcknowledged: Boolean(row.live_acknowledged_at),
    pausedReason: (row.paused_reason as string | null) ?? null,
    liveVenue: (row.live_venue as string | null) ?? "oanda",
    manageTrades: row.manage_trades !== false,
    managePartials: row.manage_partials !== false,
    trailAfterTp1: row.trail_after_tp1 !== false,
  };
}

// Realised loss today at the trader's live broker account, as a percentage of
// account equity, plus the equity used for position sizing.
export async function dailyLossPct(_client: Client, userId: string): Promise<{ pct: number; equity: number }> {
  const { liveAccountFacts } = await import("@/lib/auto-trade.server");
  const facts = await liveAccountFacts(userId);
  return { pct: facts.dailyLossPct, equity: facts.equity };
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
    await logAutopilotEvent(userId, "paused", reason, {
      dailyLossPct: pct,
      capPct: settings.maxDailyLossPct,
    });
    try {
      await createNotification({
        userId,
        kind: "system",
        title: "Autopilot paused",
        body: reason,
        url: "/autopilot",
      });
    } catch {
      // notification failure must not block the halt
    }
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

      // Auto mode places the trade itself. On paper that is a paper position; on
      // a connected account it is a real market order with the stop and target
      // attached. A setup whose trigger has not fired is never auto-placed.
      const executable =
        verdict.allowed && settings.mode === "auto" && draft.units !== null && draft.triggered;
      if (verdict.allowed && settings.mode === "auto" && !draft.triggered) {
        result.skipped.push(`${symbol}: setup filed but not triggered yet`);
      }
      const autoLive = executable;

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
          account_target: "live",
          reasoning: draft.reasoning,
          status: verdict.allowed ? (executable ? "approved" : "pending") : "blocked",
          rejection_reason: verdict.allowed ? null : verdict.reason,
          decided_at: executable ? new Date().toISOString() : null,
        } as never)
        .select("id")
        .single();
      if (error) {
        result.skipped.push(`${symbol}: could not be saved`);
        continue;
      }

      if (!verdict.allowed) {
        result.blocked += 1;
        await logAutopilotEvent(
          userId,
          "blocked",
          `${draft.symbol} ${draft.side} blocked: ${verdict.reason ?? "rails"}`,
          { symbol: draft.symbol, grade: draft.grade, proposalId: inserted.id },
        );
        continue;
      }
      result.created += 1;
      await logAutopilotEvent(
        userId,
        "proposal",
        `${draft.symbol} ${draft.side} grade ${draft.grade ?? "-"} filed at ${draft.entry}`,
        {
          symbol: draft.symbol,
          grade: draft.grade,
          entry: draft.entry,
          stop: draft.stopLoss,
          target: draft.takeProfit,
          proposalId: inserted.id,
        },
      );


      if (autoLive) {
        const size = Math.max(1, Math.floor(draft.units ?? 1));
        const { placeLiveOrder } = await import("@/lib/autopilot-live.server");
        const sent = await placeLiveOrder(userId, settings.liveVenue, {
          symbol: draft.symbol,
          side: draft.side,
          units: size,
          entry: draft.entry,
          stopLoss: draft.stopLoss,
          takeProfit: draft.takeProfit,
        });
        if (!sent.ok) {
          await client
            .from("autopilot_proposals")
            .update({ status: "failed", rejection_reason: sent.detail })
            .eq("id", inserted.id as string);
          await logAutopilotEvent(userId, "failed", `${draft.symbol} live order failed: ${sent.detail}`, {
            symbol: draft.symbol,
            proposalId: inserted.id,
          });
        } else {
          await client
            .from("autopilot_proposals")
            .update({ status: "filled", broker_order_id: sent.orderId ?? null })
            .eq("id", inserted.id as string);
          result.executed += 1;
          openPositions += 1;
          await logAutopilotEvent(
            userId,
            "filled",
            `${draft.symbol} ${draft.side} placed at your ${settings.liveVenue.toUpperCase()} account, ${size} units. ${sent.detail}`,
            { symbol: draft.symbol, size, entry: draft.entry, proposalId: inserted.id, live: true },
          );
          try {
            await createNotification({
              userId,
              kind: "system",
              title: `Autopilot placed ${draft.symbol} ${draft.side}`,
              body: sent.detail,
              url: "/autopilot",
            });
          } catch {
            // notification failure must not undo a real fill
          }
        }
      }

    } catch {
      result.skipped.push(`${symbol}: data unavailable`);
    }
  }

  // Trade management: protect anything autopilot itself filled at the live
  // account. Never in manual mode, and never a trade the trader placed by hand.
  if (settings.manageTrades && settings.mode === "auto") {
    try {
      const { manageLiveTrades } = await import("@/lib/autopilot-live.server");
      const managed = await manageLiveTrades(userId, settings.liveVenue, {
        breakEven: true,
        partials: settings.managePartials,
        trail: settings.trailAfterTp1,
      });
      if (managed.movedToBreakEven + managed.partialsTaken + managed.trailed > 0) {
        await logAutopilotEvent(
          userId,
          "run",
          `Trade management: ${managed.partialsTaken} partial(s) banked, ${managed.movedToBreakEven} stop(s) at break-even, ${managed.trailed} trailed. ${managed.notes.join(" ")}`,
          { managed },
        );
      }
    } catch {
      // management failure must not fail the run
    }
  }

  await logAutopilotEvent(
    userId,
    "run",
    `Scan finished: ${result.scanned} instruments, ${result.created} filed, ${result.blocked} blocked, ${result.executed} auto-filled`,
    { ...result, timeframe },
  );

  return result;
}

