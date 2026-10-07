// Opportunity ledger. One row per (setup, entry candidate), including setups
// whose level never filled and candidates the detector could not price.
// Setups come from the SHARED detector (@/lib/detector/entry-detector).
import { computeEntryCandidates, CANDIDATE_MODELS } from "@/lib/detector/entry-detector";
import { feed } from "./feeder";
import { simulate, type FillCfg, type FillResult, type QuoteBar } from "./fills";
import type { RigBar } from "./download";

export type Variant = (typeof CANDIDATE_MODELS)[number] | "break_close";
export const VARIANTS: Variant[] = ["break_close", ...CANDIDATE_MODELS];

export type LedgerRow = FillResult & {
  inst: string; setupTime: number; day: string; long: boolean; variant: Variant;
  level: number | null; risk: number; target: number; rejectReason: string | null;
};

const toBar = (b: RigBar) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c });
const toQ = (b: RigBar): QuoteBar => ({ t: b.t, bh: b.bh, bl: b.bl, ah: b.ah, al: b.al, bc: b.bc, ac: b.ac, ao: b.ao, bo: b.bo });

export function medianSpread(bars: RigBar[]) {
  const s = bars.slice(-5000).map((b) => b.ac - b.bc).filter((x) => x > 0).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

export function buildSetups(inst: string, h1: RigBar[]) {
  const bars = h1.map(toBar);
  const seen = new Set<number>();
  const setups: Array<{ setupTime: number; long: boolean; risk: number; target: number; breakClose: number; levels: Partial<Record<string, number>> }> = [];
  for (const { now, view } of feed(bars, { warmup: 150, window: 151 })) {
    const atr = view.slice(-14).reduce((a, b) => a + (b.high - b.low), 0) / 14;
    for (const bias of ["Long", "Short"] as const) {
      const c = computeEntryCandidates({ bias, atr, lastPrice: now.close, candles1h: view });
      // Arm only on the bar the break closed: no hindsight in picking setups.
      if (c.state !== "armed" || c.breakTime !== now.time || seen.has(now.time * 2 + (bias === "Long" ? 1 : 0))) continue;
      seen.add(now.time * 2 + (bias === "Long" ? 1 : 0));
      setups.push({ setupTime: now.time + 3600, long: c.direction === "long", risk: c.risk!, target: c.target!, breakClose: now.close, levels: c.levels });
    }
  }
  return { inst, setups };
}

export function scoreSetups(
  inst: string,
  setups: ReturnType<typeof buildSetups>["setups"],
  m15: RigBar[],
  cfg: FillCfg,
  opts: { horizonSec?: number; m1?: (t: number) => QuoteBar[] | null } = {},
): LedgerRow[] {
  const H = opts.horizonSec ?? 72 * 3600;
  const q = m15.map(toQ);
  const rows: LedgerRow[] = [];
  let lo = 0;
  for (const s of setups) {
    while (lo < q.length && q[lo]!.t < s.setupTime) lo++;
    let hi = lo; while (hi < q.length && q[hi]!.t < s.setupTime + H) hi++;
    const fwd = q.slice(lo, hi);
    const day = new Date(s.setupTime * 1000).toISOString().slice(0, 10);
    for (const v of VARIANTS) {
      const level = v === "break_close" ? s.breakClose : s.levels[v] ?? null;
      const base = { inst, setupTime: s.setupTime, day, long: s.long, variant: v, level, risk: s.risk, target: s.target };
      if (level == null) { rows.push({ ...base, ...unfilled(), rejectReason: "no-level" }); continue; }
      if (v === "break_close" && (s.long ? s.target <= level : s.target >= level)) { rows.push({ ...base, ...unfilled(), rejectReason: "target-behind-market" }); continue; }
      const r = simulate({ long: s.long, entry: v === "break_close" ? "market" : level, risk: s.risk, target: s.target, bars: fwd, cfg, m1: opts.m1 });
      rows.push({ ...base, ...r, rejectReason: r.filled ? null : "never-filled" });
    }
  }
  return rows;
}

const unfilled = (): FillResult => ({ filled: false, fillTime: null, exit: "unfilled", r: 0, mfeR: 0, maeR: 0, barsToFavourable: null, ambiguous: "none" });

export function toCsv(rows: LedgerRow[]) {
  const cols = ["inst", "setupTime", "day", "long", "variant", "level", "risk", "target", "filled", "fillTime", "exit", "r", "mfeR", "maeR", "barsToFavourable", "ambiguous", "rejectReason"] as const;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => String(r[c] ?? "")).join(","))].join("\n");
}
