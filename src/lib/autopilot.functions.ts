// Autopilot: AI-proposed trades with human-in-the-loop approval.
// Phase 1 stores settings + proposals and enforces the rails server-side.
// Execution stays behind an explicit approve step.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireCapability } from "@/lib/capability-middleware";
import {
  DEFAULT_AUTOPILOT_SETTINGS,
  evaluateRails,
  type AutopilotSettings,
} from "@/lib/autopilot.shared";

export const getAutopilotSettings = createServerFn({ method: "GET" })
  .middleware([requireCapability("autopilot")])
  .handler(async ({ context }): Promise<AutopilotSettings> => {
    const { data } = await context.supabase
      .from("autopilot_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { ...DEFAULT_AUTOPILOT_SETTINGS };
    return {
      mode: data.mode as AutopilotSettings["mode"],
      accountTarget: data.account_target as AutopilotSettings["accountTarget"],
      minGrade: data.min_grade as AutopilotSettings["minGrade"],
      riskPct: Number(data.risk_pct),
      maxOpenPositions: Number(data.max_open_positions),
      maxDailyLossPct: Number(data.max_daily_loss_pct),
      allowedSymbols: data.allowed_symbols ?? [],
      sessionWindows: data.session_windows ?? [],
      liveAcknowledged: Boolean(data.live_acknowledged_at),
      pausedReason: data.paused_reason ?? null,
      liveVenue: (data as Record<string, unknown>)["live_venue"] as string ?? "oanda",
      manageTrades: (data as Record<string, unknown>)["manage_trades"] !== false,
    };
  });

export const updateAutopilotSettings = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        mode: z.enum(["manual", "confirm", "auto"]).optional(),
        accountTarget: z.enum(["paper", "live"]).optional(),
        liveVenue: z.string().trim().min(2).max(40).optional(),
        manageTrades: z.boolean().optional(),
        minGrade: z.enum(["A+", "A", "B"]).optional(),
        riskPct: z.number().min(0.1).max(5).optional(),
        maxOpenPositions: z.number().int().min(1).max(20).optional(),
        maxDailyLossPct: z.number().min(0.5).max(20).optional(),
        allowedSymbols: z.array(z.string()).optional(),
        sessionWindows: z.array(z.string()).optional(),
        acknowledgeLive: z.boolean().optional(),
        pausedReason: z.string().nullable().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { user_id: context.userId };
    if (data.mode !== undefined) patch.mode = data.mode;
    if (data.accountTarget !== undefined) patch.account_target = data.accountTarget;
    if (data.liveVenue !== undefined) patch.live_venue = data.liveVenue;
    if (data.manageTrades !== undefined) patch.manage_trades = data.manageTrades;
    if (data.minGrade !== undefined) patch.min_grade = data.minGrade;
    if (data.riskPct !== undefined) patch.risk_pct = data.riskPct;
    if (data.maxOpenPositions !== undefined) patch.max_open_positions = data.maxOpenPositions;
    if (data.maxDailyLossPct !== undefined) patch.max_daily_loss_pct = data.maxDailyLossPct;
    if (data.allowedSymbols !== undefined) patch.allowed_symbols = data.allowedSymbols;
    if (data.sessionWindows !== undefined) patch.session_windows = data.sessionWindows;
    if (data.pausedReason !== undefined) patch.paused_reason = data.pausedReason;
    if (data.acknowledgeLive !== undefined) {
      patch.live_acknowledged_at = data.acknowledgeLive ? new Date().toISOString() : null;
    }

    const { error } = await context.supabase
      .from("autopilot_settings")
      .upsert(patch as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listAutopilotProposals = createServerFn({ method: "GET" })
  .middleware([requireCapability("autopilot")])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("autopilot_proposals")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const nowMs = Date.now();
    return (data ?? []).map((p) => ({
      id: p.id as string,
      symbol: p.symbol as string,
      timeframe: (p.timeframe as string | null) ?? null,
      side: p.side as "long" | "short",
      grade: (p.grade as string | null) ?? null,
      confidence: p.confidence === null ? null : Number(p.confidence),
      entry: Number(p.entry),
      stopLoss: p.stop_loss === null ? null : Number(p.stop_loss),
      takeProfit: p.take_profit === null ? null : Number(p.take_profit),
      units: p.units === null ? null : Number(p.units),
      orderType: p.order_type as string,
      accountTarget: p.account_target as "paper" | "live",
      reasoning: (p.reasoning as string | null) ?? null,
      status:
        p.status === "pending" && new Date(p.expires_at as string).getTime() < nowMs
          ? ("expired" as const)
          : (p.status as string),
      rejectionReason: (p.rejection_reason as string | null) ?? null,
      realizedR: p.realized_r === null ? null : Number(p.realized_r),
      expiresAt: p.expires_at as string,
      createdAt: p.created_at as string,
    }));
  });

export const createAutopilotProposal = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        symbol: z.string().min(1),
        timeframe: z.string().optional(),
        side: z.enum(["long", "short"]),
        grade: z.string().optional(),
        confidence: z.number().optional(),
        entry: z.number(),
        stopLoss: z.number().optional(),
        takeProfit: z.number().optional(),
        units: z.number().optional(),
        orderType: z.enum(["market", "limit", "stop"]).default("market"),
        reasoning: z.string().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const settingsRes = await context.supabase
      .from("autopilot_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    const row = settingsRes.data;
    const settings: AutopilotSettings = row
      ? {
          mode: row.mode as AutopilotSettings["mode"],
          accountTarget: row.account_target as AutopilotSettings["accountTarget"],
          minGrade: row.min_grade as AutopilotSettings["minGrade"],
          riskPct: Number(row.risk_pct),
          maxOpenPositions: Number(row.max_open_positions),
          maxDailyLossPct: Number(row.max_daily_loss_pct),
          allowedSymbols: row.allowed_symbols ?? [],
          sessionWindows: row.session_windows ?? [],
          liveAcknowledged: Boolean(row.live_acknowledged_at),
          pausedReason: row.paused_reason ?? null,
          liveVenue: ((row as Record<string, unknown>)["live_venue"] as string) ?? "oanda",
          manageTrades: (row as Record<string, unknown>)["manage_trades"] !== false,
        }
      : { ...DEFAULT_AUTOPILOT_SETTINGS };

    const { count } = await context.supabase
      .from("autopilot_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .in("status", ["approved", "filled"]);

    const verdict = evaluateRails(settings, {
      symbol: data.symbol,
      grade: data.grade ?? null,
      openPositions: count ?? 0,
    });

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
        stop_loss: data.stopLoss ?? null,
        take_profit: data.takeProfit ?? null,
        units: data.units ?? null,
        risk_pct: settings.riskPct,
        order_type: data.orderType,
        account_target: settings.accountTarget,
        reasoning: data.reasoning ?? null,
        status: verdict.allowed ? "pending" : "blocked",
        rejection_reason: verdict.allowed ? null : verdict.reason,
      })
      .select("id, status")
      .single();
    if (error) throw new Error(error.message);

    return { id: inserted.id as string, status: inserted.status as string, blockedReason: verdict.reason };
  });

export const decideAutopilotProposal = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        reason: z.string().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { data: proposal, error: loadError } = await context.supabase
      .from("autopilot_proposals")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!proposal) throw new Error("Proposal not found");
    if (proposal.status !== "pending") throw new Error(`This proposal is already ${proposal.status}`);
    if (new Date(proposal.expires_at as string).getTime() < Date.now()) {
      await context.supabase
        .from("autopilot_proposals")
        .update({ status: "expired", decided_at: new Date().toISOString() })
        .eq("id", data.id);
      throw new Error("This proposal expired before it was approved");
    }

    const status = data.decision === "approve" ? "approved" : "rejected";
    const { error } = await context.supabase
      .from("autopilot_proposals")
      .update({
        status,
        rejection_reason: data.decision === "reject" ? (data.reason ?? "Rejected by trader") : null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    return {
      status,
      order:
        data.decision === "approve"
          ? {
              symbol: proposal.symbol as string,
              side: proposal.side as "long" | "short",
              units: proposal.units === null ? null : Number(proposal.units),
              orderType: proposal.order_type as "market" | "limit" | "stop",
              price: Number(proposal.entry),
              stopLoss: proposal.stop_loss === null ? null : Number(proposal.stop_loss),
              takeProfit: proposal.take_profit === null ? null : Number(proposal.take_profit),
              accountTarget: proposal.account_target as "paper" | "live",
            }
          : null,
    };
  });

export const markAutopilotProposalResult = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["filled", "failed"]),
        brokerOrderId: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("autopilot_proposals")
      .update({
        status: data.status,
        broker_order_id: data.brokerOrderId ?? null,
        rejection_reason: data.error ?? null,
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

// Phase 3: run the scan stack over the trader's allowed instruments, enforce the
// daily loss cap, and in auto mode fill paper trades without a tap.
export const runAutopilotScan = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z.object({ timeframe: z.string().default("60") }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("The analysis service is not configured right now.");

    const { data: row } = await context.supabase
      .from("autopilot_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { runAutopilotForUser, settingsFromRow } = await import("@/lib/autopilot-run.server");
    const settings = settingsFromRow((row as Record<string, unknown> | null) ?? null);
    return await runAutopilotForUser(context.supabase, context.userId, settings, data.timeframe, apiKey);
  });


// Execute an approved proposal on the paper account. Live orders go through
// the broker path on the client so the OANDA margin guard still applies.
export const fillAutopilotProposalOnPaper = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: proposal, error } = await context.supabase
      .from("autopilot_proposals")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!proposal) throw new Error("Proposal not found");
    if (proposal.status !== "approved") throw new Error(`Proposal is ${proposal.status}, not approved`);

    const { data: account } = await context.supabase
      .from("paper_accounts")
      .select("status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (account && account.status !== "active") {
      throw new Error(`Your paper account is ${account.status}. Resume it before filling trades.`);
    }

    const size = proposal.units === null ? 1 : Math.max(1, Number(proposal.units));
    const { error: insertError } = await context.supabase.from("paper_positions").insert({
      user_id: context.userId,
      symbol: proposal.symbol as string,
      side: proposal.side as string,
      size,
      entry: Number(proposal.entry),
      stop: proposal.stop_loss === null ? null : Number(proposal.stop_loss),
      take_profit: proposal.take_profit === null ? null : Number(proposal.take_profit),
      grade: (proposal.grade as string | null) ?? null,
    });
    if (insertError) {
      await context.supabase
        .from("autopilot_proposals")
        .update({ status: "failed", rejection_reason: insertError.message })
        .eq("id", data.id)
        .eq("user_id", context.userId);
      throw new Error(insertError.message);
    }

    await context.supabase
      .from("autopilot_proposals")
      .update({ status: "filled" })
      .eq("id", data.id)
      .eq("user_id", context.userId);

    return { ok: true as const, size };
  });

// ---- Audit log + manual kill switch (phase: autopilot hardening) ----

export type AutopilotEventRow = {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
};

export const listAutopilotEvents = createServerFn({ method: "GET" })
  .middleware([requireCapability("autopilot")])
  .handler(async ({ context }): Promise<AutopilotEventRow[]> => {
    const { data, error } = await context.supabase
      .from("autopilot_events")
      .select("id, kind, message, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as string,
      message: r.message as string,
      createdAt: r.created_at as string,
    }));
  });

// Manual kill switch. Pausing drops autopilot out of the scheduled tick
// immediately; resuming clears the reason and records who cleared it.
export const setAutopilotPause = createServerFn({ method: "POST" })
  .middleware([requireCapability("autopilot")])
  .inputValidator((raw: unknown) =>
    z.object({ paused: z.boolean(), reason: z.string().max(300).optional() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const reason = data.paused
      ? (data.reason?.trim() || "Paused by you. Autopilot will not scan or fill until you resume it.")
      : null;
    const { error } = await context.supabase
      .from("autopilot_settings")
      .upsert({ user_id: context.userId, paused_reason: reason } as never, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    const { logAutopilotEvent } = await import("@/lib/autopilot-events.server");
    await logAutopilotEvent(
      context.userId,
      data.paused ? "paused" : "resumed",
      data.paused ? (reason as string) : "Autopilot resumed by you.",
    );
    return { ok: true as const, pausedReason: reason };
  });
