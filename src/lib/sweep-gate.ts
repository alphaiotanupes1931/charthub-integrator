// Liquidity sweep gate (spec Fix 1). Pure and deterministic.
//
// Today an unprotected break (swept=false) only caps the grade at C, so the
// engine still issues a graded directional entry - the 9/29 EUR/USD short.
// This gate turns swept=false into HOLD with watch levels and null levels.
//
// It runs in SHADOW: `require_sweep` defaults off for every model, so the
// result is recorded next to the published signal and changes nothing until
// the volume measurement is reviewed and the flag is turned on.
//
// Definitions (bearish; mirrored for bullish):
//   break_level  swing low a candle BODY closed below
//   origin       swing high the breaking leg started from
//   sweep_target nearest prior swing high beyond the origin
//   swept        traded beyond sweep_target + tol and CLOSED back inside it
//   tolerance    max(1 tick, k * ATR14), k = 0.05
//   stop         sweep extreme + 0.25 * ATR, never a fixed pip distance
//   expiry       48 entry-timeframe bars with no sweep

import type { BosRead, PsCandle } from "@/lib/protectedStructure";

export type SweepGateState = "HOLD" | "ARMED" | "ACTIVE" | "INVALIDATED";

export type SweepGateConfig = {
  requireSweep: boolean;
  toleranceAtrK: number;
  stopBufferAtrK: number;
  expiryBars: number;
};

export const DEFAULT_SWEEP_GATE: SweepGateConfig = {
  requireSweep: false, // shadow until Marcus signs off on volume
  toleranceAtrK: 0.05,
  stopBufferAtrK: 0.25,
  expiryBars: 48,
};

/** Per-model flag. All off: the gate is measured, not enforced. */
export const REQUIRE_SWEEP_BY_MODEL: Record<string, boolean> = {
  classic: false,
  "trading-channel": false,
  photon: false,
  "eric-jablonski": false,
  wyckoff: false,
};

export type SweepGateResult = {
  state: SweepGateState;
  swept: boolean;
  /** Letter grade is withheld while not ACTIVE. */
  gradeAllowed: boolean;
  bos: { breakLevel: number; originLevel: number; sweepTarget: number | null } | null;
  watch: { sweepLevel: number; invalidation: number; expiresAfterBars: number } | null;
  /** Stop implied by a printed sweep: extreme + buffer. */
  sweepStop: number | null;
  sweepExtreme: number | null;
  rationale: string;
};

export function sweepTolerance(atr: number, tick: number, k = DEFAULT_SWEEP_GATE.toleranceAtrK): number {
  return Math.max(tick, isFinite(atr) ? k * atr : 0);
}

/**
 * The one shared pre-entry check. Every model's signal builder goes through
 * this before it may return a directional entry.
 */
export function validateBosProtection(args: {
  bos: BosRead | null | undefined;
  side: "long" | "short";
  /** Closed entry-timeframe candles AFTER the break, oldest first. */
  after: PsCandle[];
  atr: number;
  tick: number;
  fmt?: (n: number) => string;
  config?: Partial<SweepGateConfig>;
}): SweepGateResult {
  const cfg = { ...DEFAULT_SWEEP_GATE, ...args.config };
  const fmt = args.fmt ?? ((n: number) => String(n));
  const bos = args.bos;
  const wanted = args.side === "long" ? "bullish" : "bearish";
  if (!bos || bos.kind !== wanted) {
    return { state: "ACTIVE", swept: true, gradeAllowed: true, bos: null, watch: null, sweepStop: null, sweepExtreme: null, rationale: "No opposing break of structure to validate." };
  }
  const base = { breakLevel: bos.breakLevel, originLevel: bos.originLevel, sweepTarget: bos.priorLevel };
  if (bos.swept) {
    return { state: "ACTIVE", swept: true, gradeAllowed: true, bos: base, watch: null, sweepStop: null, sweepExtreme: null, rationale: "Protected break: liquidity was swept before the break." };
  }
  const target = bos.priorLevel;
  if (target == null || !isFinite(target)) {
    return { state: "HOLD", swept: false, gradeAllowed: false, bos: base, watch: null, sweepStop: null, sweepExtreme: null, rationale: "Unprotected break with no identifiable liquidity pool. No entry." };
  }
  const tol = sweepTolerance(args.atr, args.tick, cfg.toleranceAtrK);
  const bearish = args.side === "short";
  const invalidation = bearish ? target + tol : target - tol;
  const watch = { sweepLevel: target, invalidation, expiresAfterBars: cfg.expiryBars };

  let extreme: number | null = null;
  for (let i = 0; i < args.after.length; i++) {
    const c = args.after[i];
    // Body close beyond the pool is acceptance, not a sweep.
    if (bearish ? c.close > invalidation : c.close < invalidation) {
      return { state: "INVALIDATED", swept: false, gradeAllowed: false, bos: base, watch, sweepStop: null, sweepExtreme: null, rationale: `Price accepted beyond ${fmt(target)} on a closed candle. Idea invalidated.` };
    }
    const pierced = bearish ? c.high > target + tol : c.low < target - tol;
    const closedBack = bearish ? c.close < target : c.close > target;
    if (pierced && closedBack) {
      extreme = bearish ? Math.max(extreme ?? -Infinity, c.high) : Math.min(extreme ?? Infinity, c.low);
      const stop = bearish ? extreme + cfg.stopBufferAtrK * args.atr : extreme - cfg.stopBufferAtrK * args.atr;
      // Confirmation (body close back through CISD / LTF break) is judged by the
      // model after this; the gate only reports that the sweep has printed.
      return { state: "ARMED", swept: true, gradeAllowed: false, bos: base, watch, sweepStop: stop, sweepExtreme: extreme, rationale: `Sweep of ${fmt(target)} printed at ${fmt(extreme)}. Wait for a close back through structure before entering.` };
    }
    if (i + 1 >= cfg.expiryBars) {
      return { state: "INVALIDATED", swept: false, gradeAllowed: false, bos: base, watch, sweepStop: null, sweepExtreme: null, rationale: `No sweep of ${fmt(target)} within ${cfg.expiryBars} bars. Idea expired.` };
    }
  }
  const dir = bearish ? "below" : "above";
  return {
    state: "HOLD", swept: false, gradeAllowed: false, bos: base, watch, sweepStop: null, sweepExtreme: null,
    rationale: `Unprotected break: liquidity at ${fmt(target)} not swept. Wait for a sweep and a close back ${dir} ${fmt(target)}.`,
  };
}

/** What the gate would do to a published signal. Shadow-only unless the model's flag is on. */
export function applySweepGate<T extends { grade: string; entry: string; stop: string; tp1: string }>(
  plan: T,
  gate: SweepGateResult,
  modelId: string,
): { enforced: boolean; plan: T } {
  const enforced = REQUIRE_SWEEP_BY_MODEL[modelId] === true && gate.state !== "ACTIVE";
  if (!enforced) return { enforced: false, plan };
  return { enforced: true, plan: { ...plan, grade: "NO ENTRY", entry: "-", stop: "-", tp1: "-" } };
}
