// Autopilot: AI-proposed trades with human-in-the-loop approval.
// Phase 1 stores settings + proposals and enforces the rails server-side.
// Execution stays behind an explicit approve step.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_AUTOPILOT_SETTINGS,
  evaluateRails,
  type AutopilotSettings,
} from "@/lib/autopilot.shared";

export const getAutopilotSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
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
    };
  });

export const updateAutopilotSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        mode: z.enum(["manual", "confirm", "auto"]).optional(),
        accountTarget: z.enum(["paper", "live"]).optional(),
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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

// Phase 2: run the scan stack over the trader's allowed instruments and file
// proposals for anything that clears the rails.
export const runAutopilotScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
        }
      : { ...DEFAULT_AUTOPILOT_SETTINGS };

    const symbols = settings.allowedSymbols.length
      ? settings.allowedSymbols.slice(0, 8)
      : DEFAULT_AUTOPILOT_SETTINGS.allowedSymbols;

    const { data: account } = await context.supabase
      .from("paper_accounts")
      .select("balance")
      .eq("user_id", context.userId)
      .maybeSingle();
    const equity = account?.balance ? Number(account.balance) : 10_000;

    const { data: existing } = await context.supabase
      .from("autopilot_proposals")
      .select("symbol, status, expires_at")
      .eq("user_id", context.userId)
      .eq("status", "pending");
    const nowMs = Date.now();
    const openSymbols = new Set(
      (existing ?? [])
        .filter((p) => new Date(p.expires_at as string).getTime() > nowMs)
        .map((p) => p.symbol as string),
    );

    const { count } = await context.supabase
      .from("autopilot_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .in("status", ["approved", "filled"]);

    const { buildProposalDraft } = await import("@/lib/autopilot.server");

    let created = 0;
    let blocked = 0;
    const skipped: string[] = [];

    for (const symbol of symbols) {
      if (openSymbols.has(symbol)) {
        skipped.push(`${symbol}: already waiting for you`);
        continue;
      }
      try {
        const draft = await buildProposalDraft(apiKey, symbol, data.timeframe, settings, equity);
        if (!draft) {
          skipped.push(`${symbol}: no setup`);
          continue;
        }
        const verdict = evaluateRails(settings, {
          symbol,
          grade: draft.grade,
          openPositions: count ?? 0,
        });
        const { error } = await context.supabase.from("autopilot_proposals").insert({
          user_id: context.userId,
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
          status: verdict.allowed ? "pending" : "blocked",
          rejection_reason: verdict.allowed ? null : verdict.reason,
        });
        if (error) {
          skipped.push(`${symbol}: could not be saved`);
          continue;
        }
        if (verdict.allowed) created += 1;
        else blocked += 1;
      } catch {
        skipped.push(`${symbol}: data unavailable`);
      }
    }

    return { created, blocked, skipped, scanned: symbols.length };
  });

// Execute an approved proposal on the paper account. Live orders go through
// the broker path on the client so the OANDA margin guard still applies.
export const fillAutopilotProposalOnPaper = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
