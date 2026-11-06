import { buildBrokerSnapshots } from "./broker-readonly.server";
import { DEFAULT_AUTOPILOT_SETTINGS, evaluateRails } from "./autopilot.shared";
import { sizeFromRisk } from "./auto-trade.server";
import { demoOnlyRefusal } from "./autopilot-live.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export async function coachAccountFacts(userId: string, db: SupabaseClient<Database>, symbol: string, grade: string) {
  const { data: row, error } = await db.from("autopilot_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Your trading limits could not be checked.");
  const result = await buildBrokerSnapshots(userId);
  if (!result.connected) throw new Error("Connect your broker before reviewing a trade.");
  const preferred = row?.live_venue ?? "tradelocker";
  const account = result.snapshots.find((s) => s.broker === preferred);
  if (!account?.accountId) throw new Error("Select a trading account on the Broker page first.");
  if (account.readWarnings?.some((w) => /Open positions|Protective orders|configuration/.test(w))) throw new Error("Account positions or protection could not be checked. Refresh your broker connection first.");
  const live = account.broker === "tradelocker" ? account.accountType !== "demo" : account.env !== "practice";
  const refused = demoOnlyRefusal(live ? "live" : "demo", row?.demo_only);
  if (refused) throw new Error(refused);
  const realized = account.realizedToday ?? account.recentCloses
    .filter((c) => c.closedAt && Date.parse(c.closedAt) >= new Date().setUTCHours(0, 0, 0, 0))
    .reduce((sum, c) => sum + c.realizedPL, 0);
  const equity = account.equity ?? account.balance ?? 0;
  if (equity <= 0) throw new Error("This selected account has no available equity.");
  const rails = evaluateRails({
    ...DEFAULT_AUTOPILOT_SETTINGS, liveAcknowledged: true,
    minGrade: row?.min_grade as "A+" | "A" | "B" | "ALL" ?? DEFAULT_AUTOPILOT_SETTINGS.minGrade,
    allowedSymbols: row?.allowed_symbols ?? [], pausedReason: row?.paused_reason ?? null,
    maxOpenPositions: row?.max_open_positions ?? DEFAULT_AUTOPILOT_SETTINGS.maxOpenPositions,
    maxDailyLossPct: row?.max_daily_loss_pct ?? DEFAULT_AUTOPILOT_SETTINGS.maxDailyLossPct,
  }, { symbol, grade, openPositions: account.positions.length, dailyLossPct: Math.max(0, -realized / equity * 100) });
  if (!rails.allowed) throw new Error(rails.reason ?? "Trade blocked by your limits.");
  return { account, live, equity, riskPct: row?.risk_pct ?? DEFAULT_AUTOPILOT_SETTINGS.riskPct, sizeFromRisk };
}