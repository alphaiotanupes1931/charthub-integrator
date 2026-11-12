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
    liveVenue: (row.live_venue as string | null) ?? "tradelocker",
    manageTrades: row.manage_trades !== false,
    managePartials: row.manage_partials !== false,
    trailAfterTp1: row.trail_after_tp1 !== false,
    demoOnly: row.demo_only === true,
    sizingBalance: row.sizing_balance == null ? null : Number(row.sizing_balance),
  };
}

// Realised loss today at the trader's live broker account, as a percentage of
// account equity, plus the equity used for position sizing.
export async function dailyLossPct(
  _client: Client,
  userId: string,
): Promise<{ pct: number; equity: number; openPositions: number | null; openBySymbol: Record<string, number> }> {
  const { liveAccountFacts } = await import("@/lib/auto-trade.server");
  const facts = await liveAccountFacts(userId);
  return {
    pct: facts.dailyLossPct,
    equity: facts.equity,
    openPositions: facts.connected ? facts.openPositions : null,
    openBySymbol: facts.openBySymbol ?? {},
  };
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

  const { pct, equity, openPositions: brokerOpen, openBySymbol } = await dailyLossPct(client, userId);
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


  // Demo test schedule: one trade per New York hour, 9 AM to 5 PM weekdays.
  let hourlyLimitReached = false;
  let skipNewEntries = false;
  if (settings.demoOnly && settings.mode === "auto") {
    const { demoScheduleSlot, slotStart } = await import("@/lib/autopilot-schedule.shared");
    const now = new Date();
    if (demoScheduleSlot(now) === null) {
      result.haltedReason = "Outside the 9 AM to 5 PM New York trading window";
      skipNewEntries = true;
    } else {
      const { count: thisHour } = await client
      .from("autopilot_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      // Resting limit orders count too, so each 15-minute run cannot add another.
      .or("status.eq.filled,and(status.eq.approved,order_type.in.(limit,limit_tradelocker))")
      .gte("decided_at", slotStart(now).toISOString());
    if ((thisHour ?? 0) > 0) {
      result.haltedReason = "Already placed this hour's trade";
      skipNewEntries = true;
    }
    }
  }

  // Entry timing never suspends protection of positions already open.
  const symbols = skipNewEntries ? [] : settings.allowedSymbols.length
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
  // Prefer the broker's real open positions; old filled rows stay "filled"
  // forever and would otherwise block every new trade.
  let openPositions = brokerOpen ?? count ?? 0;
  // Resting TradeLocker limits have no broker expiry; retire them after 4h.
  if (settings.demoOnly) {
    await (await import("@/lib/autopilot-live.server")).cancelStaleTradeLockerLimits(userId).catch(() => 0);
  }

  for (const symbol of symbols) {
    try {
      const draft = await buildProposalDraft(apiKey, symbol, timeframe, settings, (await import("@/lib/autopilot.shared")).sizingEquity(equity, settings.sizingBalance), { client, userId });
      // Pending entries are not a reason to stop rescanning: the draw may have
      // invalidated or the entry may now be confirmed. Retire superseded plans
      // only after the new evaluation has been saved successfully.
      if (waiting.has(symbol)) {
        const { error: retireError } = await client.from("autopilot_proposals")
          .update({ status: "expired", decided_at: new Date().toISOString(), rejection_reason: "Superseded by a fresh scan" })
          .eq("user_id", userId).eq("symbol", symbol).eq("status", "pending");
        if (retireError) {
          result.skipped.push(`${symbol}: pending setup could not be refreshed`);
          continue;
        }
      }
      if (!draft) {
        result.skipped.push(`${symbol}: no setup`);
        continue;
      }
      const verdict = evaluateRails(settings, {
        symbol,
        grade: draft.grade,
        openPositions,
        openOnSymbol: openBySymbol[(await import("@/lib/auto-trade.server")).symbolKey(symbol)] ?? 0,
        dailyLossPct: pct,
      });
      if (draft.scanId) {
        await client.from("scan_log").update({ refused_reason: verdict.allowed
          ? (draft.triggered ? null : draft.triggerRule ?? "Waiting for entry confirmation") : verdict.reason ?? "Blocked by risk limits" })
          .eq("id", draft.scanId).eq("user_id", userId);
      }

      // Auto mode places the trade itself. On paper that is a paper position; on
      // a connected account it is a real market order with the stop and target
      // attached. A setup whose trigger has not fired is never auto-placed.
      const executable =
        !hourlyLimitReached &&
        verdict.allowed && settings.mode === "auto" && draft.units !== null && draft.triggered;
      if (verdict.allowed && settings.mode === "auto" && !draft.triggered) {
        result.skipped.push(`${symbol}: setup filed but not triggered yet`);
      }
      const autoLive = executable;
      // Demo only: instead of waiting for a touch between 15-minute checks, rest
      // a limit order at the planned entry so a fast tag-and-go still fills.
      const restBase =
        !executable && !hourlyLimitReached && verdict.allowed && settings.mode === "auto"
        && settings.demoOnly
        && draft.units !== null && !draft.triggered && draft.stopLoss != null && draft.entry != null;
      // US OANDA only takes forex; indices/metals/oil rest on TradeLocker Demo.
      const isFx = (await import("@/lib/venue-routing.shared")).isForexPair(draft.symbol);
      const restLimit = restBase && settings.liveVenue === "oanda" && isFx;
      const restTradeLocker = restBase && !isFx;

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
          risk_pct: draft.riskPct ?? settings.riskPct,
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
      if (draft.scanId) await client.from("scan_log").update({ autopilot_proposal_id: inserted.id } as never).eq("id", draft.scanId).eq("user_id", userId);

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


      if (restLimit || restTradeLocker) {
        const live = await import("@/lib/autopilot-live.server");
        const place = restTradeLocker ? live.placeRestingTradeLockerLimit : live.placeRestingLimitOrder;
        const venueLabel = restTradeLocker ? "TradeLocker Demo" : "OANDA Demo";
        const rest = await place(userId, {
          symbol: draft.symbol,
          side: draft.side,
          units: Math.max(1, Math.floor(draft.units ?? 1)),
          entry: draft.entry,
          stopLoss: draft.stopLoss,
          takeProfit: draft.takeProfit,
          runner: draft.runner ?? null,
        });
        if (rest.ok) {
          await client.from("autopilot_proposals")
            .update({ status: "approved", order_type: restTradeLocker ? live.TL_LIMIT_ORDER_TYPE : "limit", broker_order_id: rest.orderId ?? null, decided_at: new Date().toISOString() } as never)
            .eq("id", inserted.id as string);
          openPositions += 1;
          { const k = (await import("@/lib/auto-trade.server")).symbolKey(draft.symbol); openBySymbol[k] = (openBySymbol[k] ?? 0) + 1; }
          hourlyLimitReached = true;
          await logAutopilotEvent(userId, "proposal", `${draft.symbol} ${draft.side}: ${rest.detail}`, { symbol: draft.symbol, proposalId: inserted.id, resting: true });
          if (draft.scanId) await client.from("scan_log").update({ taken: true, taken_at: new Date().toISOString() }).eq("id", draft.scanId).eq("user_id", userId);
          // Journal only real fills; a waiting order may expire without trading.
          if ((rest as { filled?: boolean }).filled) {
          const { journalPlacedTrade } = await import("@/lib/journal-auto.server");
          await journalPlacedTrade({
            userId,
            proposalId: inserted.id as string,
            symbol: draft.symbol,
            side: draft.side,
            timeframe: (draft as { timeframe?: string | null }).timeframe ?? null,
            entry: Number(draft.entry),
            stopLoss: Number(draft.stopLoss),
            takeProfit: draft.takeProfit ?? null,
            units: Math.max(1, Math.floor(draft.units ?? 1)),
            grade: (draft as { grade?: string | null }).grade ?? null,
            detail: `Filled via limit order on ${venueLabel}. ${rest.detail}`,
          });
          }
        } else if (!rest.duplicate) {
          await logAutopilotEvent(userId, "failed", `${draft.symbol} resting order failed: ${rest.detail}`, { symbol: draft.symbol, proposalId: inserted.id });
        }
      }

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
          runner: draft.runner ?? null,
        }, { demoOnly: settings.demoOnly });
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
          if (draft.scanId) await client.from("scan_log").update({ taken: true, taken_at: new Date().toISOString() }).eq("id", draft.scanId).eq("user_id", userId);
          openPositions += 1;
          { const k = (await import("@/lib/auto-trade.server")).symbolKey(draft.symbol); openBySymbol[k] = (openBySymbol[k] ?? 0) + 1; }
          if (settings.demoOnly) hourlyLimitReached = true;
          const { journalPlacedTrade } = await import("@/lib/journal-auto.server");
          await journalPlacedTrade({
            userId,
            proposalId: inserted.id as string,
            symbol: draft.symbol,
            side: draft.side,
            timeframe: (draft as { timeframe?: string | null }).timeframe ?? null,
            entry: draft.entry,
            stopLoss: Number(draft.stopLoss),
            takeProfit: draft.takeProfit ?? null,
            units: size,
            grade: (draft as { grade?: string | null }).grade ?? null,
            detail: sent.detail,
          });
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

