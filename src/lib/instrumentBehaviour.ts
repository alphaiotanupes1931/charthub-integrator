/**
 * Per-instrument behaviour (how each market actually moves).
 *
 * The Wyckoff / order-block RULES stay identical everywhere. What differs per
 * instrument is measurable and lives here:
 *
 *  - which sessions the instrument actually trends in (a EUR/USD signal at 02:00
 *    UTC is noise; a JPN225 signal at 02:00 UTC is prime time),
 *  - how long a winning move typically needs (scalp / intraday / swing) so take
 *    profits are not set at a distance the instrument never travels in a session,
 *  - how targets should be chosen (nearest liquidity vs measured move vs range
 *    extreme),
 *  - how good our measured edge on that instrument is, which sets the highest
 *    grade the instrument is allowed to earn until replay proves better.
 *
 * Type-only import of Grade keeps this module free of a cycle with biasEngine.
 */

import type { Grade } from "./agents/biasEngine";
import type { SessionKey } from "./instrument-profile.shared";
import { engineSymbolFor } from "./agents/biasEngine";

export type InstrumentClass = "fx_major" | "fx_yen" | "fx_commodity" | "metal" | "index" | "crypto" | "energy" | "rates" | "other";

export type TradeStyle = "scalp" | "intraday" | "swing";

export type TargetStrategy = "liquidity" | "measured_move" | "range_extreme";

export interface InstrumentBehaviour {
  symbol: string;
  klass: InstrumentClass;
  /** Sessions where this instrument prints tradable expansion. */
  activeSessions: SessionKey[];
  /** Single best session, overridden by the measured profile when we have one. */
  bestSession: SessionKey;
  /** Typical holding style for a valid setup here. */
  style: TradeStyle;
  /** Expected hold in 4H bars, used for "expected duration" and exit-by copy. */
  holdBars4h: number;
  /** Runs through the weekend / overnight without a close. */
  continuous: boolean;
  targetStrategy: TargetStrategy;
  /** Highest grade this instrument may earn, from measured replay expectancy. */
  gradeCeiling: Grade;
  /** Measured expectancy per trade in R from the last replay, null if unmeasured. */
  expectancyR: number | null;
  /** One-line trader-facing character note. */
  character: string;
}

const GRADE_ORDER: Grade[] = ["A+", "A", "B", "C", "D", "F"];

/** Local copy so this module does not import runtime code from the engine. */
export function capBehaviourGrade(grade: Grade, ceiling: Grade): Grade {
  return GRADE_ORDER.indexOf(grade) < GRADE_ORDER.indexOf(ceiling) ? ceiling : grade;
}

/**
 * Measured expectancy per trade in R, from the stored engine replay.
 * Refresh these from the replay report; they are the only thing that lifts an
 * instrument's grade ceiling.
 */
export const MEASURED_EXPECTANCY_R: Record<string, number> = {
  XAU_USD: 0.11,
  XAG_USD: 0.11,
  EUR_USD: 0.08,
  NAS100: 0.05,
  WTICO_USD: 0.01,
  SPX500: -0.02,
  ETH_USD: -0.02,
  BTC_USD: -0.03,
  US30: -0.03,
  GBP_USD: -0.03,
  XRP_USD: -0.06,
  USD_JPY: -0.1,
};

/**
 * Grade ceiling from expectancy. An instrument only earns A+ once replay shows a
 * real edge; a losing instrument is capped at B so it can still be shown and
 * journalled without being sold as a sniper setup.
 */
export function ceilingFromExpectancy(expectancy: number | null): Grade {
  if (expectancy === null) return "B";
  if (expectancy >= 0.05) return "A+";
  if (expectancy > 0) return "A";
  return "B";
}

type Spec = Omit<InstrumentBehaviour, "symbol" | "gradeCeiling" | "expectancyR">;

const FX_MAJOR: Spec = {
  klass: "fx_major",
  activeSessions: ["london", "newyork"],
  bestSession: "london",
  style: "intraday",
  holdBars4h: 6,
  continuous: false,
  targetStrategy: "liquidity",
  character: "Trends in the London open and the London/New York overlap. Asia is chop, so setups there are held back until London.",
};

const FX_YEN: Spec = {
  ...FX_MAJOR,
  klass: "fx_yen",
  activeSessions: ["asia", "london", "newyork"],
  bestSession: "newyork",
  character: "Moves on the Tokyo open as well as London and New York, and respects round-number liquidity strongly.",
};

const FX_COMMODITY: Spec = {
  ...FX_MAJOR,
  klass: "fx_commodity",
  activeSessions: ["asia", "london", "newyork"],
  bestSession: "asia",
  character: "Driven by the Asia session and commodity flow; London can reverse the Asia move, so targets stay near liquidity.",
};

const METAL: Spec = {
  klass: "metal",
  activeSessions: ["london", "newyork"],
  bestSession: "newyork",
  style: "intraday",
  holdBars4h: 8,
  continuous: false,
  targetStrategy: "measured_move",
  character: "Expands hard on the London fix and the New York open, trends cleanly once structure breaks, so measured-move targets hold.",
};

const US_INDEX: Spec = {
  klass: "index",
  activeSessions: ["london", "newyork"],
  bestSession: "newyork",
  style: "intraday",
  holdBars4h: 4,
  continuous: false,
  targetStrategy: "measured_move",
  character: "Cash-session instrument: the move belongs to the New York open. Overnight legs continue, so a runner can be held past the close rather than flattened at 16:00 ET.",
};

const EU_INDEX: Spec = {
  ...US_INDEX,
  activeSessions: ["london", "newyork"],
  bestSession: "london",
  character: "Frankfurt and London open drive the range; by the New York afternoon it follows the US indices instead of leading.",
};

const ASIA_INDEX: Spec = {
  ...US_INDEX,
  activeSessions: ["asia", "london"],
  bestSession: "asia",
  character: "Tokyo cash session sets the day. Signals after the Asia close are stale.",
};

const CRYPTO: Spec = {
  klass: "crypto",
  activeSessions: ["asia", "london", "newyork"],
  bestSession: "newyork",
  style: "swing",
  holdBars4h: 12,
  continuous: true,
  targetStrategy: "liquidity",
  character: "Trades 24/7 with fat tails and weekend gaps of its own. Stops need extra room and winners need multi-day holds, not intraday exits.",
};

const ENERGY: Spec = {
  klass: "energy",
  activeSessions: ["london", "newyork"],
  bestSession: "newyork",
  style: "intraday",
  holdBars4h: 6,
  continuous: false,
  targetStrategy: "range_extreme",
  character: "Inventory and news driven, mean-reverts inside its range more often than it trends, so targets sit at the range extreme.",
};

const RATES: Spec = {
  klass: "rates",
  activeSessions: ["london", "newyork"],
  bestSession: "london",
  style: "swing",
  holdBars4h: 10,
  continuous: false,
  targetStrategy: "liquidity",
  character: "Slow, macro driven and thin outside cash hours. Only worth taking on clean structure.",
};

const OTHER: Spec = {
  klass: "other",
  activeSessions: ["london", "newyork"],
  bestSession: "newyork",
  style: "intraday",
  holdBars4h: 6,
  continuous: false,
  targetStrategy: "liquidity",
  character: "No measured character yet. Treated conservatively until it has been profiled on two years of bars.",
};

const SPECS: Record<string, Spec> = {
  XAU_USD: METAL, XAG_USD: METAL, XPT_USD: METAL, XPD_USD: METAL,
  SPX500: US_INDEX, NAS100: US_INDEX, US30: US_INDEX,
  GER40: EU_INDEX, UK100: EU_INDEX, JPN225: ASIA_INDEX,
  BTC_USD: CRYPTO, ETH_USD: CRYPTO, XRP_USD: CRYPTO, SOL_USD: CRYPTO, DOGE_USD: CRYPTO,
  WTICO_USD: ENERGY, BCO_USD: ENERGY, NATGAS_USD: ENERGY,
  EUR_USD: FX_MAJOR, GBP_USD: FX_MAJOR, USD_CHF: FX_MAJOR, EUR_GBP: FX_MAJOR,
  USD_JPY: FX_YEN, EUR_JPY: FX_YEN, GBP_JPY: FX_YEN,
  AUD_USD: FX_COMMODITY, NZD_USD: FX_COMMODITY, USD_CAD: FX_COMMODITY,
};

function specFor(symbol: string): Spec {
  const direct = SPECS[symbol];
  if (direct) return direct;
  if (/^(BTC|ETH|XRP|SOL|DOGE|LTC|BCH|ADA)_/.test(symbol)) return CRYPTO;
  if (/JPY$/.test(symbol) && /^[A-Z]{3}_[A-Z]{3}$/.test(symbol)) return FX_YEN;
  if (/^X[A-Z]{2}_USD$/.test(symbol)) return METAL;
  if (/(USB|BUND|UK10|_YR|Y_USD)/.test(symbol)) return RATES;
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(symbol)) return FX_MAJOR;
  return OTHER;
}

/** Measured profile fields that refine the shipped behaviour. */
export type BehaviourProfileHint = { bestSession?: SessionKey; barsSampled?: number } | null | undefined;

export function behaviourFor(ticker: string, profile?: BehaviourProfileHint): InstrumentBehaviour {
  const symbol = engineSymbolFor(ticker);
  const spec = specFor(symbol);
  const expectancyR = symbol in MEASURED_EXPECTANCY_R ? MEASURED_EXPECTANCY_R[symbol] : null;
  const measuredBest = profile && (profile.barsSampled ?? 0) >= 200 ? profile.bestSession : undefined;
  const bestSession = measuredBest ?? spec.bestSession;
  const activeSessions = spec.activeSessions.includes(bestSession)
    ? spec.activeSessions
    : [...spec.activeSessions, bestSession];
  return {
    ...spec,
    symbol,
    activeSessions,
    bestSession,
    expectancyR,
    gradeCeiling: ceilingFromExpectancy(expectancyR),
  };
}

export function sessionAt(timeMs: number): SessionKey {
  const h = new Date(timeMs).getUTCHours();
  if (h >= 7 && h < 13) return "london";
  if (h >= 13 && h < 21) return "newyork";
  return "asia";
}

export interface SessionGate {
  session: SessionKey;
  active: boolean;
  best: boolean;
  /** Grade letters to subtract. Never flips direction. */
  gradeDelta: number;
  note: string;
}

const LABEL: Record<SessionKey, string> = { asia: "Asia", london: "London", newyork: "New York" };

/**
 * Session quality for this instrument right now. Outside its liquid window the
 * setup is still valid, it just cannot be graded as a prime signal: this is the
 * single biggest source of "the entry was too early" on FX and index setups.
 */
export function sessionGate(behaviour: InstrumentBehaviour, nowMs: number): SessionGate {
  const session = sessionAt(nowMs);
  const active = behaviour.continuous || behaviour.activeSessions.includes(session);
  const best = session === behaviour.bestSession;
  if (!active) {
    return {
      session, active, best, gradeDelta: -2,
      note: `${behaviour.symbol} does not expand in the ${LABEL[session]} session. Wait for ${LABEL[behaviour.bestSession]} before entering.`,
    };
  }
  if (!best) {
    return {
      session, active, best, gradeDelta: -1,
      note: `${LABEL[session]} session is tradable on ${behaviour.symbol} but ${LABEL[behaviour.bestSession]} is where its clean moves happen.`,
    };
  }
  return { session, active, best, gradeDelta: 0, note: `${LABEL[session]} session, the best window for ${behaviour.symbol}.` };
}

const STYLE_LABEL: Record<TradeStyle, string> = { scalp: "Scalp", intraday: "Intraday", swing: "Swing" };

/** Expected duration copy, so take profits match what the instrument travels. */
export function expectedHold(behaviour: InstrumentBehaviour): { style: TradeStyle; hours: number; label: string } {
  const hours = behaviour.holdBars4h * 4;
  return {
    style: behaviour.style,
    hours,
    label: `${STYLE_LABEL[behaviour.style]} · typically ${hours < 24 ? `${hours}h` : `${Math.round(hours / 24)} day${hours >= 48 ? "s" : ""}`}`,
  };
}

/** Trader-facing brief handed to the planner and the AI coach. */
export function behaviourBrief(behaviour: InstrumentBehaviour, nowMs?: number): string {
  const hold = expectedHold(behaviour);
  const lines = [
    `INSTRUMENT BEHAVIOUR: ${behaviour.symbol} (${behaviour.klass})`,
    `Sessions: active ${behaviour.activeSessions.map((s) => LABEL[s]).join(", ")}; best ${LABEL[behaviour.bestSession]}.`,
    `Style: ${hold.label}. Targets from ${behaviour.targetStrategy.replace("_", " ")}.`,
    `Max grade allowed: ${behaviour.gradeCeiling}${behaviour.expectancyR === null ? " (no measured edge yet)" : ` (measured expectancy ${behaviour.expectancyR}R per trade)`}.`,
    `Character: ${behaviour.character}`,
  ];
  if (nowMs !== undefined) lines.push(`Now: ${sessionGate(behaviour, nowMs).note}`);
  return lines.join("\n");
}

/** Grade arithmetic local to this module (keeps it free of an engine cycle). */
export function shiftBehaviourGrade(grade: Grade, delta: number): Grade {
  const i = GRADE_ORDER.indexOf(grade);
  const next = Math.min(GRADE_ORDER.length - 1, Math.max(0, i - delta));
  return GRADE_ORDER[next];
}

/**
 * Apply this instrument's own behaviour to a graded setup:
 *  1. session quality (wrong session for this market drops the grade),
 *  2. measured-edge ceiling (no A grades on a market that has not earned them).
 * Direction, entry, stop and targets are never touched here.
 */
export function applyBehaviourGrade(
  grade: Grade,
  behaviour: InstrumentBehaviour,
  nowMs: number,
): { grade: Grade; notes: string[]; session: SessionGate } {
  const session = sessionGate(behaviour, nowMs);
  const notes: string[] = [session.note];
  let out = grade;
  if (session.gradeDelta !== 0) out = shiftBehaviourGrade(out, session.gradeDelta);
  const capped = capBehaviourGrade(out, behaviour.gradeCeiling);
  if (capped !== out) {
    notes.push(
      behaviour.expectancyR === null
        ? `${behaviour.symbol} has no measured edge yet, so it cannot grade above ${behaviour.gradeCeiling}.`
        : `${behaviour.symbol} replay expectancy is ${behaviour.expectancyR}R per trade, so it cannot grade above ${behaviour.gradeCeiling}.`,
    );
    out = capped;
  }
  const hold = expectedHold(behaviour);
  notes.push(`Expected duration on ${behaviour.symbol}: ${hold.label}. Targets from ${behaviour.targetStrategy.replace("_", " ")}.`);
  return { grade: out, notes, session };
}
