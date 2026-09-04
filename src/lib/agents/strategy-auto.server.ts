// Server adapter: turn a live market snapshot into the strategy pick the
// planner should grade against, so the trader never has to choose a playbook.
import { STRATEGIES } from "@/data/strategies";
import {
  pickStrategyForConditions,
  type AutoStrategyPick,
  type MarketConditions,
} from "@/lib/strategyAuto";
import type { MarketSnapshot } from "./types";

function marketFor(ticker: string): MarketConditions["market"] {
  const t = ticker.toUpperCase();
  if (/BTC|ETH|SOL|USDT|DOGE|XRP|ADA/.test(t)) return "Crypto";
  if (/XAU|XAG|GOLD|SILVER|WTI|OIL|USOIL|BRENT|NGAS/.test(t)) return "Commodities";
  if (/NAS100|SPX|US30|NDX|GSPC|DJI|DAX|FTSE|NIKKEI/.test(t)) return "Futures";
  if (/^[A-Z]{3}\/?[A-Z]{3}$/.test(t.replace("_", "/"))) return "Forex";
  return "Stocks";
}

export function conditionsFromSnapshot(snap: MarketSnapshot): MarketConditions {
  const price = snap.lastPrice || snap.candles[snap.candles.length - 1]?.close || 1;
  const atrPct = price > 0 ? (snap.stats.atr14 / price) * 100 : 0;
  const nearHigh = price >= snap.stats.high20 - snap.stats.atr14 * 0.25;
  const nearLow = price <= snap.stats.low20 + snap.stats.atr14 * 0.25;
  return {
    interval: snap.interval,
    trend: snap.mtf?.h4.trend ?? "range",
    alignment: snap.mtf?.alignment ?? "none",
    cisd: snap.cisd.state,
    atrPct,
    rangePct: snap.stats.range20Pct,
    atRangeEdge: nearHigh || nearLow,
    volRatio: snap.orderFlow?.lastVolRatio ?? 1,
    depth: snap.orderFlow?.depth ?? "normal",
    market: marketFor(snap.ticker),
    sessionOpen: (snap.sessionsActive?.length ?? 0) > 0,
  };
}

/** Playbook text the planner grades against, built from the library entry. */
export function describePick(pick: AutoStrategyPick): string {
  const s = STRATEGIES.find((x) => x.slug === pick.slug);
  if (!s) return pick.name;
  return [
    s.name,
    `style ${s.style}`,
    `level ${s.level}`,
    `baseline R:R ${s.rr}`,
    `baseline win rate ${s.winRate}%`,
    s.description,
    `Auto-selected because: ${pick.reason}`,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 800);
}

export function autoStrategyForSnapshot(snap: MarketSnapshot): {
  pick: AutoStrategyPick;
  desc: string;
} {
  const pick = pickStrategyForConditions(conditionsFromSnapshot(snap));
  return { pick, desc: describePick(pick) };
}
