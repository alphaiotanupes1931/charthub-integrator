// Auto trading from the home page: read the trader's automation settings plus
// their live account state, and place a scanned setup they approved.
// Live only - there is no practice path here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "@/lib/capability-middleware";
import {
  DEFAULT_AUTOPILOT_SETTINGS,
  evaluateRails,
  gradeMeets,
  type AutopilotSettings,
} from "@/lib/autopilot.shared";

function settingsFromRow(row: Record<string, unknown> | null): AutopilotSettings {
  if (!row) return { ...DEFAULT_AUTOPILOT_SETTINGS };
  return {
    mode: (row["mode"] as AutopilotSettings["mode"]) === "auto" ? "auto" : "manual",
    minGrade: (row["min_grade"] as AutopilotSettings["minGrade"]) ?? "A",
    riskPct: Number(row["risk_pct"] ?? DEFAULT_AUTOPILOT_SETTINGS.riskPct),
    maxOpenPositions: Number(row["max_open_positions"] ?? DEFAULT_AUTOPILOT_SETTINGS.maxOpenPositions),
    maxDailyLossPct: Number(row["max_daily_loss_pct"] ?? DEFAULT_AUTOPILOT_SETTINGS.maxDailyLossPct),
    allowedSymbols: (row["allowed_symbols"] as string[] | null) ?? [],
    sessionWindows: (row["session_windows"] as string[] | null) ?? [],
    liveAcknowledged: Boolean(row["live_acknowledged_at"]),
    pausedReason: (row["paused_reason"] as string | null) ?? null,
    liveVenue: (row["live_venue"] as string | null) ?? "capitalcom",
    manageTrades: row["manage_trades"] !== false,
    managePartials: row["manage_partials"] !== false,
    trailAfterTp1: row["trail_after_tp1"] !== false,
  };
}

export type AutoTradeContext = {
  settings: AutopilotSettings;
  broker: {
    connected: boolean;
    reason: string | null;
    equity: number;
    currency: string | null;
    openPositions: number;
    dailyLossPct: number;
  };
};

export const getAutoTradeContext = createServerFn({ method: "GET" })
  .middleware([requireCapability("autopilot")])
  .handler(async ({ context }): Promise<AutoTradeContext> => {
    const { data } = await context.supabase
      .from("autopilot_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    const settings = settingsFromRow((data as Record<string, unknown> | null) ?? null);

    const { liveAccountFacts } = await import("@/lib/auto-trade.server");
    const facts = await liveAccountFacts(context.userId);
    return {
      settings,
      broker: {
        connected: facts.connected,
        reason: facts.reason,
        equity: facts.equity,
        currency: facts.currency,
        openPositions: facts.openPositions,
        dailyLossPct: facts.dailyLossPct,
      },
    };
  });

/** Manual/Auto switch on the home page, plus the one-time live acknowledgement. */
export const setAutoTradingMode = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        mode: z.enum(["manual", "auto"]),
        minGrade: z.enum(["A+", "A", "B"]).optional(),
        acknowledgeLive: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {
      user_id: context.userId,
      mode: data.mode,
      account_target: "live",
    };
    if (data.minGrade) patch.min_grade = data.minGrade;
    if (data.acknowledgeLive) patch.live_acknowledged_at = new Date().toISOString();
    const { error } = await context.supabase
      .from("autopilot_settings")
      .upsert(patch as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Size preview for the trade offer popup: how many units the trader's own risk
 * setting allows on this exact entry/stop, and what that costs if it stops out.
 */
export const previewAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z.object({ entry: z.number(), stop: z.number() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("autopilot_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    const settings = settingsFromRow((row as Record<string, unknown> | null) ?? null);
    const { liveAccountFacts, sizeFromRisk } = await import("@/lib/auto-trade.server");
    const facts = await liveAccountFacts(context.userId);
    const units = sizeFromRisk(facts.equity, settings.riskPct, data.entry, data.stop);
    return {
      connected: facts.connected,
      reason: facts.reason,
      equity: facts.equity,
      currency: facts.currency,
      riskPct: settings.riskPct,
      riskAmount: Math.round(((facts.equity * settings.riskPct) / 100) * 100) / 100,
      units,
    };
  });

/**
 * Place a scanned setup the trader just approved in the popup. Records the
 * decision, sends the order with the stop and target attached, and logs it.
 */
export const placeAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        symbol: z.string().min(1).max(30),
        timeframe: z.string().max(20).optional(),
        side: z.enum(["long", "short"]),
        grade: z.string().max(10).optional(),
        confidence: z.number().optional(),
        entry: z.number(),
        stopLoss: z.number(),
        takeProfit: z.number().optional(),
        reasoning: z.string().max(2000).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("autopilot_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    const settings = settingsFromRow((row as Record<string, unknown> | null) ?? null);
    if (!settings.liveAcknowledged) {
      throw new Error("Turn Auto Trading on once and accept the live-order notice before placing trades.");
    }

    const { liveAccountFacts, sizeFromRisk } = await import("@/lib/auto-trade.server");
    const facts = await liveAccountFacts(context.userId);
    if (!facts.connected) {
      throw new Error(
        facts.reason ?? "No broker account is connected. Connect one on the Broker page and try again.",
      );
    }

    const verdict = evaluateRails(
      { ...settings, allowedSymbols: [] },
      {
        symbol: data.symbol,
        grade: data.grade ?? null,
        openPositions: facts.openPositions,
        dailyLossPct: facts.dailyLossPct,
      },
    );
    if (!verdict.allowed) throw new Error(verdict.reason ?? "This trade breaks one of your risk rails.");

    const units = sizeFromRisk(facts.equity, settings.riskPct, data.entry, data.stopLoss);
    if (!units) {
      throw new Error("Your account is too small for this stop distance at your current risk setting.");
    }

    const { data: inserted, error } = await context.supabase
      .from("autopilot_proposals")
      .insert({
        user_id: context.userId,
        symbol: data.symbol,
        timeframe: data.timeframe ?? null,
        side: data.side,
        grade: data.grade ?? null,
        confidence: data.confidence ?? null,
        entry: data.entry,
        stop_loss: data.stopLoss,
        take_profit: data.takeProfit ?? null,
        units,
        risk_pct: settings.riskPct,
        order_type: "market",
        account_target: "live",
        reasoning: data.reasoning ?? null,
        status: "approved",
        decided_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const proposalId = inserted.id as string;

    const { placeLiveOrder } = await import("@/lib/autopilot-live.server");
    const { logAutopilotEvent } = await import("@/lib/autopilot-events.server");
    const sent = await placeLiveOrder(context.userId, settings.liveVenue, {
      symbol: data.symbol,
      side: data.side,
      units,
      entry: data.entry,
      stopLoss: data.stopLoss,
      takeProfit: data.takeProfit ?? null,
    });

    if (!sent.ok) {
      await context.supabase
        .from("autopilot_proposals")
        .update({ status: "failed", rejection_reason: sent.detail })
        .eq("id", proposalId);
      await logAutopilotEvent(context.userId, "failed", `${data.symbol} order failed: ${sent.detail}`, {
        symbol: data.symbol,
        proposalId,
      });
      throw new Error(sent.detail);
    }

    await context.supabase
      .from("autopilot_proposals")
      .update({ status: "filled", broker_order_id: sent.orderId ?? null })
      .eq("id", proposalId);
    await logAutopilotEvent(
      context.userId,
      "filled",
      `${data.symbol} ${data.side} placed from a scan, ${units} units at ${data.entry}. ${sent.detail}`,
      { symbol: data.symbol, units, entry: data.entry, proposalId, live: true },
    );

    return { ok: true as const, units, detail: sent.detail };
  });

/** Skip: recorded so the decision feed shows what was offered and declined. */
export const skipAutoTrade = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z.object({ symbol: z.string().min(1).max(30), grade: z.string().max(10).optional() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { logAutopilotEvent } = await import("@/lib/autopilot-events.server");
    await logAutopilotEvent(
      context.userId,
      "blocked",
      `${data.symbol} ${data.grade ? `grade ${data.grade} ` : ""}offer skipped`,
      { symbol: data.symbol },
    );
    return { ok: true as const };
  });

export { gradeMeets };
