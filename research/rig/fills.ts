// Day 5: fill simulator on bid/ask bars.
// Longs buy at the ask and exit at the bid; shorts the reverse. A limit fills
// only when price trades THROUGH the level by `buffer` (a wick tag is not a
// fill). Stops pay slippage. If one bar holds both stop and target we ask the
// caller for M1 bars; if those are missing or still ambiguous, it is a stop.

export type QuoteBar = { t: number; bh: number; bl: number; ah: number; al: number; bc: number; ac: number; ao: number; bo: number };

export type FillResult = {
  filled: boolean;
  fillTime: number | null;
  exit: "target" | "stop" | "timeout" | "unfilled";
  r: number;          // net R, intent to trade: unfilled = 0
  mfeR: number;
  maeR: number;
  barsToFavourable: number | null; // bars until +1R
  ambiguous: "none" | "m1-resolved" | "pessimistic";
};

export type FillCfg = { buffer: number; stopSlip: number; costMult: number };

export function simulate(args: {
  long: boolean; entry: number | "market"; risk: number; target: number; bars: QuoteBar[];
  cfg: FillCfg; m1?: (barTime: number) => QuoteBar[] | null;
}): FillResult {
  const { long, risk, target, bars, cfg } = args;
  const buf = cfg.buffer * cfg.costMult, slip = cfg.stopSlip * cfg.costMult;
  // Spread widening for the 1.5x cost check: scale half-spread around the mid.
  const ask = (b: QuoteBar, k: "ah" | "al" | "ao") => b[k] + ((b.ah - b.bh) / 2) * (cfg.costMult - 1);
  const bid = (b: QuoteBar, k: "bh" | "bl" | "bo") => b[k] - ((b.ah - b.bh) / 2) * (cfg.costMult - 1);
  let i = 0, fill: number | null = null, fillTime: number | null = null;
  if (args.entry === "market") {
    if (!bars.length) return blank();
    fill = long ? ask(bars[0]!, "ao") : bid(bars[0]!, "bo");
    fillTime = bars[0]!.t;
  } else {
    const lv = args.entry;
    for (; i < bars.length; i++) {
      const b = bars[i]!;
      if (long ? ask(b, "al") <= lv - buf : bid(b, "bh") >= lv + buf) { fill = lv; fillTime = b.t; break; }
    }
    if (fill == null) return blank();
  }
  const stop = long ? fill - risk : fill + risk;
  let mfe = 0, mae = 0, fav: number | null = null, amb: FillResult["ambiguous"] = "none";
  for (let k = i; k < bars.length; k++) {
    const b = bars[k]!;
    const hi = long ? bid(b, "bh") : -ask(b, "al"), lo = long ? bid(b, "bl") : -ask(b, "ah");
    const f = long ? fill : -fill;
    mfe = Math.max(mfe, (hi - f) / risk); mae = Math.max(mae, (f - lo) / risk);
    if (fav == null && mfe >= 1) fav = k - i;
    const hitStop = long ? bid(b, "bl") <= stop : ask(b, "ah") >= stop;
    const hitTgt = long ? bid(b, "bh") >= target : ask(b, "al") <= target;
    if (hitStop && hitTgt) {
      const sub = args.m1?.(b.t);
      const order = sub ? firstHit(sub, long, stop, target) : null;
      if (order === "target") return done("target", "m1-resolved");
      amb = order === "stop" ? "m1-resolved" : "pessimistic";
      return done("stop", amb);
    }
    if (hitStop) return done("stop", amb);
    if (hitTgt) return done("target", amb);
  }
  const last = bars[bars.length - 1]!;
  const mark = long ? last.bc : last.ac;
  return { filled: true, fillTime, exit: "timeout", r: round((long ? mark - fill : fill - mark) / risk), mfeR: round(mfe), maeR: round(mae), barsToFavourable: fav, ambiguous: amb };

  function done(exit: "target" | "stop", a: FillResult["ambiguous"]): FillResult {
    const gross = exit === "target" ? Math.abs(target - fill!) / risk : -1 - slip / risk;
    return { filled: true, fillTime, exit, r: round(gross), mfeR: round(mfe), maeR: round(mae), barsToFavourable: fav, ambiguous: a };
  }
  function blank(): FillResult {
    return { filled: false, fillTime: null, exit: "unfilled", r: 0, mfeR: 0, maeR: 0, barsToFavourable: null, ambiguous: "none" };
  }
}

function firstHit(sub: QuoteBar[], long: boolean, stop: number, target: number): "stop" | "target" | null {
  for (const b of sub) {
    const s = long ? b.bl <= stop : b.ah >= stop;
    const t = long ? b.bh >= target : b.al <= target;
    if (s && t) return null;
    if (s) return "stop";
    if (t) return "target";
  }
  return null;
}
const round = (n: number) => Math.round(n * 1000) / 1000;
