// Paper-only research bots (Phase 6).
//
// A bot is a deterministic loop around the same scanner the dashboard uses:
// getSnapshot -> computeBias -> gradeScan. AI never chooses direction, entry,
// stop, or target here — the engine's numbers are recorded verbatim.
//
// ISOLATION RULE: this module must never import venue/broker/autopilot code.
// A bot can only write to the paper_bot_* tables, so no live order can ever
// be created from this path. The unit tests assert that boundary.

import { getSnapshot } from "@/lib/agents/market-data.server";
import { computeBias } from "@/lib/agents/bias-adapter.server";
import type { ScanResult } from "@/lib/agents/biasEngine";
import { SCANNER_METHODOLOGY_VERSION } from "@/lib/scanner-methodology";
import type { Json } from "@/integrations/supabase/types";

export type PaperBotRow = {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  trade_style: string;
  min_grade: string;
  status: "running" | "paused";
  methodology_version: string;
  last_tick_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PaperBotTradeRow = {
  id: string;
  bot_id: string;
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  tp1: number | null;
  grade: string;
  status: "open" | "closed";
  result: "tp" | "sl" | null;
  realized_r: number | null;
  exit_price: number | null;
  opened_at: string;
  closed_at: string | null;
};

const GRADE_RANK: Record<string, number> = {
  "A+": 5,
  A: 4,
  B: 3,
  C: 2,
  "NO ENTRY": 1,
  F: 0,
};

export function gradeRank(grade: string): number {
  return GRADE_RANK[grade] ?? 0;
}

export function gradeMeets(grade: string, minGrade: string): boolean {
  return gradeRank(grade) >= gradeRank(minGrade);
}

export type BotDecision =
  | { kind: "skip"; reason: string }
  | { kind: "enter"; side: "long" | "short"; entry: number; stop: number; tp1: number | null; grade: string }
  | { kind: "exit"; tradeId: string; result: "tp" | "sl"; exitPrice: number; realizedR: number }
  | { kind: "manage"; tradeId: string; note: string };

/** Candle times arrive in seconds or milliseconds depending on the feed. */
function candleMs(time: number): number {
  return time > 1e12 ? time : time * 1000;
}

function realizedR(side: "long" | "short", entry: number, stop: number, exit: number): number {
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) return 0;
  const move = side === "long" ? exit - entry : entry - exit;
  return Math.round((move / risk) * 100) / 100;
}

/**
 * Pure decision step. One open trade per bot; exits are resolved by walking
 * closed candles since the entry. When a single candle touches both the stop
 * and the target we count the stop first — the conservative read.
 */
export function decideBotAction(args: {
  scan: ScanResult;
  openTrade: PaperBotTradeRow | null;
  candlesAfterOpen: { time: number; high: number; low: number }[];
  minGrade: string;
  lastPrice: number;
  /**
   * Grade used for the minimum-grade gate. Research bots exist to measure the
   * raw engine edge, so they gate on the engine's own grade rather than the
   * per-instrument display ceiling — otherwise an A-minimum bot on a
   * B-capped market (US30, GBP/USD, USD/JPY, BTC…) could never open a trade.
   */
  gateGrade?: string;
}): BotDecision {
  const { scan, openTrade, candlesAfterOpen, minGrade, lastPrice } = args;
  const gateGrade = args.gateGrade ?? scan.grade;

  if (openTrade) {
    const tp = openTrade.tp1;
    for (const c of candlesAfterOpen) {
      const hitSl = openTrade.side === "long" ? c.low <= openTrade.stop : c.high >= openTrade.stop;
      const hitTp = tp != null && (openTrade.side === "long" ? c.high >= tp : c.low <= tp);
      if (hitSl) {
        return {
          kind: "exit",
          tradeId: openTrade.id,
          result: "sl",
          exitPrice: openTrade.stop,
          realizedR: realizedR(openTrade.side, openTrade.entry, openTrade.stop, openTrade.stop),
        };
      }
      if (hitTp) {
        return {
          kind: "exit",
          tradeId: openTrade.id,
          result: "tp",
          exitPrice: tp,
          realizedR: realizedR(openTrade.side, openTrade.entry, openTrade.stop, tp),
        };
      }
    }
    return {
      kind: "manage",
      tradeId: openTrade.id,
      note: `Holding ${openTrade.side} ${openTrade.symbol} from ${openTrade.entry}; price ${lastPrice}.`,
    };
  }

  if (scan.status === "NO SETUP") {
    return { kind: "skip", reason: scan.notes[scan.notes.length - 1] ?? "No setup on this pass." };
  }
  if (scan.status === "PENDING CONFIRMATION") {
    return { kind: "skip", reason: "Setup exists but lower-timeframe confirmation is missing — waiting, not entering." };
  }
  if (!gradeMeets(gateGrade, minGrade)) {
    return { kind: "skip", reason: `Grade ${gateGrade} is below this bot's ${minGrade} minimum.` };
  }
  const entry = scan.entry;
  const stop = scan.stop;
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || entry === stop) {
    return { kind: "skip", reason: "Scanner returned no executable entry/stop pair." };
  }
  const tp1 = scan.targets && Number.isFinite(scan.targets[0]) ? scan.targets[0] : null;
  return {
    kind: "enter",
    side: scan.bias === "bullish" ? "long" : "short",
    entry: entry as number,
    stop: stop as number,
    tp1,
    grade: gateGrade,
  };
}

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function recordEvent(
  supabase: AdminClient,
  botId: string,
  kind: "scan" | "skip" | "enter" | "manage" | "exit" | "error",
  detail: Record<string, unknown>,
) {
  await supabase.from("paper_bot_events").insert({ bot_id: botId, kind, detail: detail as Json });
}

function scanSummary(scan: ScanResult, engineGrade?: string) {
  return {
    bias: scan.bias,
    grade: scan.grade,
    engineGrade: engineGrade ?? scan.grade,
    status: scan.status,
    entry: scan.entry ?? null,
    stop: scan.stop ?? null,
    targets: scan.targets ?? [],
    methodologyVersion: SCANNER_METHODOLOGY_VERSION,
  };
}

/** One deterministic pass for a single bot. Returns false when paused. */
export async function tickPaperBot(botId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: bot } = await supabaseAdmin.from("paper_bots").select("*").eq("id", botId).maybeSingle();
  if (!bot) return false;
  if (bot.status !== "running") return false;

  const snap = await getSnapshot(bot.symbol, bot.timeframe);
  if (snap.source === "unavailable" || snap.candles.length < 20) {
    await recordEvent(supabaseAdmin, bot.id, "skip", { reason: "Price feed unavailable on this pass." });
    await supabaseAdmin.from("paper_bots").update({ last_tick_at: new Date().toISOString() }).eq("id", bot.id);
    return true;
  }

  const readout = computeBias(snap);
  const scan = readout.result;

  const { data: open } = await supabaseAdmin
    .from("paper_bot_trades")
    .select("*")
    .eq("bot_id", bot.id)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1);
  const openTrade = (open?.[0] as PaperBotTradeRow | undefined) ?? null;

  const openedMs = openTrade ? new Date(openTrade.opened_at).getTime() : 0;
  const candlesAfterOpen = openTrade
    ? snap.candles.filter((c) => candleMs(c.time) > openedMs)
    : [];

  const decision = decideBotAction({
    scan,
    openTrade,
    candlesAfterOpen,
    minGrade: bot.min_grade,
    lastPrice: snap.lastPrice,
    gateGrade: readout.engineGrade,
  });

  if (decision.kind === "enter") {
    const { data: trade } = await supabaseAdmin
      .from("paper_bot_trades")
      .insert({
        bot_id: bot.id,
        symbol: bot.symbol,
        side: decision.side,
        entry: decision.entry,
        stop: decision.stop,
        tp1: decision.tp1,
        grade: decision.grade,
        status: "open",
      })
      .select("id")
      .single();
    await recordEvent(supabaseAdmin, bot.id, "enter", {
      ...scanSummary(scan, readout.engineGrade),
      tradeId: trade?.id ?? null,
      side: decision.side,
      note: "Paper fill at the scanner's limit entry. No live order exists.",
    });
  } else if (decision.kind === "exit") {
    await supabaseAdmin
      .from("paper_bot_trades")
      .update({
        status: "closed",
        result: decision.result,
        realized_r: decision.realizedR,
        exit_price: decision.exitPrice,
        closed_at: new Date().toISOString(),
      })
      .eq("id", decision.tradeId);
    await recordEvent(supabaseAdmin, bot.id, "exit", {
      ...scanSummary(scan, readout.engineGrade),
      tradeId: decision.tradeId,
      result: decision.result,
      realizedR: decision.realizedR,
      exitPrice: decision.exitPrice,
    });
  } else if (decision.kind === "manage") {
    await recordEvent(supabaseAdmin, bot.id, "manage", { tradeId: decision.tradeId, note: decision.note });
  } else {
    await recordEvent(supabaseAdmin, bot.id, "skip", { ...scanSummary(scan, readout.engineGrade), reason: decision.reason });
  }

  await supabaseAdmin.from("paper_bots").update({ last_tick_at: new Date().toISOString() }).eq("id", bot.id);
  return true;
}

/** Cron entry: one deterministic pass over every running bot. */
export async function tickActivePaperBots(): Promise<{ ticked: number; skipped: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: bots } = await supabaseAdmin.from("paper_bots").select("id").eq("status", "running");
  let ticked = 0;
  let skipped = 0;
  for (const b of bots ?? []) {
    try {
      if (await tickPaperBot(b.id)) ticked += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { ticked, skipped };
}
