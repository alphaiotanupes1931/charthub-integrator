// Sniper refinement - the "double down" pass on an existing scan.
//
// The normal planner picks the closest valid pullback anchor so the order has a
// high chance of filling. The sniper pass does the opposite trade-off: it drops
// to a lower timeframe, hunts the deepest still-realistic anchor (order block,
// FVG, OTE fib, value-area edge), tightens the stop to that anchor's far edge,
// and keeps the original targets. Risk shrinks, so R:R rises - the "better
// limit" a trader gets when they ask the coach to rescan for a sniper entry.
//
// Deterministic on purpose: no AI call, so the same chart always produces the
// same sniper limit and it can never contradict the levels on the chart.

import type { MarketSnapshot } from "./types";

export type SniperInput = {
  bias: "Long" | "Short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
};

export type SniperResult = {
  improved: boolean;
  /** Timeframe the refinement was computed on. */
  timeframe: string;
  lastPrice: number;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  rr: number;
  rrBefore: number;
  riskBefore: number;
  riskAfter: number;
  /** Structure the sniper entry is anchored to. */
  anchor: string;
  orderType: string;
  notes: string;
};

/** One timeframe finer than the chart the scan ran on. */
export function sniperInterval(interval: string): string {
  switch (interval) {
    case "1": return "1";
    case "5": return "1";
    case "15": return "5";
    case "60": return "15";
    case "240": return "60";
    case "D": return "240";
    case "W":
    case "M": return "D";
    default: return "15";
  }
}

type Candidate = { entry: number; far: number; label: string };

function swingLeg(snap: MarketSnapshot, bias: "Long" | "Short"): Candidate[] {
  const out: Candidate[] = [];
  // Two legs: the immediate pullback leg (last 20 bars) and the broader impulse
  // (last 60). A sniper limit that is realistic on a strong trend usually sits
  // inside the shallow leg, so both get offered and the R:R filter decides.
  for (const [lookback, tag] of [[20, "recent leg"], [60, "impulse leg"]] as const) {
    const c = snap.candles.slice(-lookback);
    if (c.length < 8) continue;
    const hi = Math.max(...c.map((x) => x.high));
    const lo = Math.min(...c.map((x) => x.low));
    if (!(hi > lo)) continue;
    const range = hi - lo;
    const pocket = [
      [0.5, "0.5 fib"],
      [0.62, "0.62 fib"],
      [0.705, "OTE 0.705 fib"],
      [0.79, "0.79 fib"],
    ] as const;
    for (const [ratio, name] of pocket) {
      if (bias === "Long") out.push({ entry: hi - range * ratio, far: lo, label: `${name} of the ${tag}` });
      else out.push({ entry: lo + range * ratio, far: hi, label: `${name} of the ${tag}` });
    }
    // The swing extreme itself: the last place structure held.
    out.push(
      bias === "Long"
        ? { entry: lo, far: lo, label: `${tag} swing low` }
        : { entry: hi, far: hi, label: `${tag} swing high` },
    );
  }
  return out;
}

function structureCandidates(snap: MarketSnapshot, bias: "Long" | "Short"): Candidate[] {
  const out: Candidate[] = [];
  const pushZone = (z: [number, number], label: string) => {
    const top = Math.max(z[0], z[1]);
    const bot = Math.min(z[0], z[1]);
    if (!Number.isFinite(top) || !Number.isFinite(bot) || bot <= 0) return;
    // Sniper fills at the FAR edge of the zone, not the near edge.
    if (bias === "Long") out.push({ entry: bot, far: bot, label });
    else out.push({ entry: top, far: top, label });
  };
  const m = snap.mtf;
  if (m) {
    if (bias === "Long") {
      m.h1.orderBlocks.bull.forEach((z) => pushZone(z, "order block low"));
      m.h1.fvg.bull.forEach((z) => pushZone(z, "FVG base"));
      m.h4.supplyDemand.demand.forEach((z) => pushZone(z, "demand zone base"));
    } else {
      m.h1.orderBlocks.bear.forEach((z) => pushZone(z, "order block high"));
      m.h1.fvg.bear.forEach((z) => pushZone(z, "FVG top"));
      m.h4.supplyDemand.supply.forEach((z) => pushZone(z, "supply zone top"));
    }
  }
  const of = snap.orderFlow;
  if (of) {
    const edge = bias === "Long" ? of.valueAreaLow : of.valueAreaHigh;
    if (Number.isFinite(edge) && edge > 0) out.push({ entry: edge, far: edge, label: bias === "Long" ? "value area low" : "value area high" });
    if (Number.isFinite(of.poc) && of.poc > 0) out.push({ entry: of.poc, far: of.poc, label: "point of control" });
  }
  return out;
}

export function refineSniper(snap: MarketSnapshot, plan: SniperInput): SniperResult {
  const last = snap.lastPrice;
  const atr = Math.max(snap.stats.atr14 || Math.abs(last) * 0.002, Math.abs(last) * 0.0005);
  const bias = plan.bias;
  const riskBefore = Math.abs(plan.entry - plan.stop);
  const rrBefore = riskBefore > 0 ? Math.abs(plan.tp1 - plan.entry) / riskBefore : 0;

  const base: SniperResult = {
    improved: false,
    timeframe: snap.interval,
    lastPrice: last,
    entry: plan.entry,
    stop: plan.stop,
    tp1: plan.tp1,
    tp2: plan.tp2,
    rr: rrBefore,
    rrBefore,
    riskBefore,
    riskAfter: riskBefore,
    anchor: "original plan",
    orderType: orderTypeFor(bias, plan.entry, last),
    notes: "No deeper anchor beat the original limit, so the first plan is still the best fill available.",
  };

  if (!(last > 0) || !(riskBefore > 0) || snap.candles.length < 20) return base;

  const minGap = Math.max(atr * 0.05, last * 0.0002);
  const maxGap = atr * 2.5; // beyond this the limit almost never fills
  const pad = Math.max(atr * 0.2, last * 0.0003);

  const cands = [...structureCandidates(snap, bias), ...swingLeg(snap, bias)];
  let best: (SniperResult & { score: number }) | null = null;

  for (const c of cands) {
    if (!Number.isFinite(c.entry) || c.entry <= 0) continue;
    const gap = bias === "Long" ? last - c.entry : c.entry - last;
    if (gap < minGap || gap > maxGap) continue;
    // A sniper limit must be deeper than the original entry, otherwise it is
    // just the same order with a worse fill probability.
    const deeper = bias === "Long" ? c.entry < plan.entry - minGap * 0.5 : c.entry > plan.entry + minGap * 0.5;
    if (!deeper) continue;

    // Stop sits past the anchor's far edge, but a sniper stop is never allowed
    // to be wider than the original plan or than 1.2x ATR: cutting risk is the
    // whole point of the pass, so the structural distance is clamped.
    const structural = Math.abs(c.entry - c.far) + pad;
    const floor = atr * 0.4;
    const ceiling = Math.min(atr * 1.2, riskBefore);
    if (ceiling < floor) continue;
    const risk = Math.min(Math.max(structural, floor), ceiling);
    const stop = bias === "Long" ? c.entry - risk : c.entry + risk;
    if (!(risk > 0)) continue;


    const rr = Math.abs(plan.tp1 - c.entry) / risk;
    if (!(rr > rrBefore + 0.15)) continue;

    const score = rr;
    if (!best || score > best.score) {
      best = {
        ...base,
        improved: true,
        entry: c.entry,
        stop,
        rr,
        riskAfter: risk,
        anchor: c.label,
        orderType: orderTypeFor(bias, c.entry, last),
        notes: "",
        score,
      };
    }
  }

  if (!best) return base;

  const dec = last >= 1000 ? 2 : last >= 10 ? 3 : last >= 1 ? 4 : 5;
  const f = (n: number) => n.toFixed(dec);
  const tighter = Math.round((1 - best.riskAfter / riskBefore) * 100);
  const { score: _score, ...result } = best;
  return {
    ...result,
    notes:
      `Rescanned on the ${snap.interval === "D" ? "daily" : `${snap.interval}m`} chart and found a deeper fill at the ${best.anchor}. ` +
      `${best.orderType} at ${f(best.entry)} with the stop at ${f(best.stop)} cuts risk by ${tighter}% and lifts R:R on TP1 from ${rrBefore.toFixed(2)} to ${best.rr.toFixed(2)}. ` +
      `Targets stay at ${f(plan.tp1)} and ${f(plan.tp2)}. This limit only fills if price trades back that far, so it is a patience trade, not a chase. Distance to fill is ${(Math.abs(best.entry - last) / atr).toFixed(2)}x ATR.`,
  };
}

function orderTypeFor(bias: "Long" | "Short", entry: number, last: number): string {
  if (!Number.isFinite(entry) || !Number.isFinite(last) || last <= 0) return bias === "Long" ? "BUY LIMIT" : "SELL LIMIT";
  const tol = Math.max(last * 0.0005, 0);
  if (bias === "Long") return entry > last + tol ? "BUY STOP" : entry < last - tol ? "BUY LIMIT" : "BUY MARKET";
  return entry < last - tol ? "SELL STOP" : entry > last + tol ? "SELL LIMIT" : "SELL MARKET";
}
