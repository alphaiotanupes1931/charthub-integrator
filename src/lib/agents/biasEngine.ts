/**
 * TradeMind bias engine v3
 *
 * Fixes the 2026-09-03 GBP/USD incident: three consecutive A-grade SHORT signals
 * issued while 4H structure, CVD and value were all turning bullish.
 *
 * Design rule behind every function in this file:
 *   Bias is COMPUTED IN CODE, not decided by the model.
 * The model receives the output of recomputeMtfBias() as an authoritative field and
 * is forbidden from contradicting it. Prompt text alone is what failed on 09-03,
 * so the deterministic parts live here.
 */

export type BiasState = 'bullish' | 'bearish' | 'neutral';
export type TrendState = 'up' | 'down' | 'range';
export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

/** 'fresh' = untouched, 'testing' = price inside it right now (this is the live trigger,
 *  NOT a dead zone), 'filled' = traded fully through, imbalance gone, do not anchor to it. */
export type ZoneState = 'fresh' | 'testing' | 'filled';

export type ReversalLevel = 'none' | 'invalidated' | 'confirmed';

export interface Candle {
  time: number; // epoch ms of candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  complete: boolean; // OANDA supplies this. Never read an incomplete candle.
}

export interface Zone {
  type: 'OB' | 'FVG';
  direction: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  state: ZoneState;
}

/** Footprint / imbalance stack. Note these are EXECUTED trades, not resting orders. */
export interface ImbalanceStack {
  direction: 'buy' | 'sell';
  top: number;
  bottom: number;
  tradedThrough: boolean; // did price close beyond the stack after it printed?
}

export interface InstrumentConfig {
  symbol: string;
  entryBuffer: number; // price units placed inside the zone edge so the limit fills past the spread
  stopBufferAtr: number; // ATR(4H) multiple added beyond the zone for the stop
  maxEntryDistanceAtr: number; // reuse of the existing entry validity gate
  minRR: number; // minimum R:R to TP1 to grade above C
  volumeSource: 'true' | 'tick'; // FX via OANDA is 'tick'. Order flow gets less weight.
}

/**
 * Per-instrument constants. The RULES are identical across every instrument.
 * Only these numbers change, because ATR scale, spread and volume quality differ.
 *
 * volumeSource: 'true' only where the feed is real exchange volume. Everything OANDA
 * serves is broker tick volume, so order flow degrades the grade by one letter rather
 * than capping it. Flip a symbol to 'true' only when a real volume feed is wired in.
 */
export const INSTRUMENTS: Record<string, InstrumentConfig> = {
  // metals
  XAU_USD: { symbol: 'XAU_USD', entryBuffer: 0.3, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  XAG_USD: { symbol: 'XAG_USD', entryBuffer: 0.01, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  XPT_USD: { symbol: 'XPT_USD', entryBuffer: 0.3, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  XPD_USD: { symbol: 'XPD_USD', entryBuffer: 0.5, stopBufferAtr: 0.6, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },

  // indices. NAS amplifies SPX, so its gate is widened 1.3x per the v2 NAS note.
  SPX500: { symbol: 'SPX500', entryBuffer: 4, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  NAS100: { symbol: 'NAS100', entryBuffer: 5, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.95, minRR: 2, volumeSource: 'tick' },
  US30: { symbol: 'US30', entryBuffer: 10, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },

  // crypto. Trades 24/7 with no session filter and fatter tails, so a wider stop buffer.
  BTC_USD: { symbol: 'BTC_USD', entryBuffer: 5, stopBufferAtr: 0.75, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  ETH_USD: { symbol: 'ETH_USD', entryBuffer: 0.5, stopBufferAtr: 0.75, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },

  // energy
  WTICO_USD: { symbol: 'WTICO_USD', entryBuffer: 0.03, stopBufferAtr: 0.6, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },

  // forex majors. Buffer is 0 because the OANDA spread is already inside the quote.
  GBP_USD: { symbol: 'GBP_USD', entryBuffer: 0, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  EUR_USD: { symbol: 'EUR_USD', entryBuffer: 0, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  USD_JPY: { symbol: 'USD_JPY', entryBuffer: 0, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  AUD_USD: { symbol: 'AUD_USD', entryBuffer: 0, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  USD_CAD: { symbol: 'USD_CAD', entryBuffer: 0, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  USD_CHF: { symbol: 'USD_CHF', entryBuffer: 0, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  NZD_USD: { symbol: 'NZD_USD', entryBuffer: 0, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },

  // remaining TradeMind watchlist symbols. Added here rather than left on the
  // conservative default, because every one of them is already shipped to users.
  GER40: { symbol: 'GER40', entryBuffer: 5, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  UK100: { symbol: 'UK100', entryBuffer: 4, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  JPN225: { symbol: 'JPN225', entryBuffer: 15, stopBufferAtr: 0.5, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  BCO_USD: { symbol: 'BCO_USD', entryBuffer: 0.03, stopBufferAtr: 0.6, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  NATGAS_USD: { symbol: 'NATGAS_USD', entryBuffer: 0.005, stopBufferAtr: 0.75, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  XRP_USD: { symbol: 'XRP_USD', entryBuffer: 0.001, stopBufferAtr: 0.75, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  SOL_USD: { symbol: 'SOL_USD', entryBuffer: 0.05, stopBufferAtr: 0.75, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
  DOGE_USD: { symbol: 'DOGE_USD', entryBuffer: 0.0002, stopBufferAtr: 0.75, maxEntryDistanceAtr: 1.5, minRR: 2, volumeSource: 'tick' },
};

/**
 * Conservative fallback for a symbol not in the table. Never silently borrow another
 * instrument's constants: a GBP/USD entry buffer on US30 is meaningless. The wider
 * stop buffer and tighter entry gate make an unknown symbol harder to grade well,
 * which is the correct direction to fail in.
 */
export const DEFAULT_CONFIG: InstrumentConfig = {
  symbol: 'UNKNOWN', entryBuffer: 0, stopBufferAtr: 0.75, maxEntryDistanceAtr: 1.0, minRR: 2, volumeSource: 'tick',
};

/**
 * TradeMind stores canonical display tickers ("XAU/USD", "NAS100", "WTI Oil").
 * The engine keys off broker-style symbols, so translate before looking up config.
 */
const PLATFORM_SYMBOLS: Record<string, string> = {
  'XAU/USD': 'XAU_USD', 'XAG/USD': 'XAG_USD', 'XPT/USD': 'XPT_USD', 'XPD/USD': 'XPD_USD',
  'EUR/USD': 'EUR_USD', 'GBP/USD': 'GBP_USD', 'USD/JPY': 'USD_JPY', 'AUD/USD': 'AUD_USD',
  'USD/CAD': 'USD_CAD', 'USD/CHF': 'USD_CHF', 'NZD/USD': 'NZD_USD',
  'BTC/USD': 'BTC_USD', 'ETH/USD': 'ETH_USD', 'XRP/USD': 'XRP_USD', 'SOL/USD': 'SOL_USD', 'DOGE/USD': 'DOGE_USD',
  'WTI Oil': 'WTICO_USD', 'Brent Oil': 'BCO_USD', NATGAS: 'NATGAS_USD',
};

export function engineSymbolFor(ticker: string): string {
  const t = (ticker ?? '').trim();
  return PLATFORM_SYMBOLS[t] ?? t.toUpperCase().replace(/[\/\s-]+/g, '_');
}

export function getInstrumentConfig(symbol: string): { cfg: InstrumentConfig; known: boolean } {
  const cfg = INSTRUMENTS[engineSymbolFor(symbol)] ?? INSTRUMENTS[symbol];
  return cfg ? { cfg, known: true } : { cfg: { ...DEFAULT_CONFIG, symbol }, known: false };
}


// ---------------------------------------------------------------------------
// grade arithmetic
// ---------------------------------------------------------------------------

const GRADES: Grade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

/** letters < 0 makes the grade worse. Clamps at A+ and F. */
export function shiftGrade(grade: Grade, letters: number): Grade {
  const i = GRADES.indexOf(grade);
  const next = Math.min(GRADES.length - 1, Math.max(0, i - letters));
  return GRADES[next];
}

export function capGrade(grade: Grade, cap: Grade): Grade {
  return GRADES.indexOf(grade) >= GRADES.indexOf(cap) ? grade : cap;
}

const opposite = (b: BiasState): BiasState => (b === 'bullish' ? 'bearish' : b === 'bearish' ? 'bullish' : 'neutral');

// ---------------------------------------------------------------------------
// swing structure
// ---------------------------------------------------------------------------

/** Fractal pivots. A swing high needs `wing` lower highs on both sides. */
export function findSwingHighs(candles: Candle[], wing = 2): number[] {
  const out: number[] = [];
  for (let i = wing; i < candles.length - wing; i++) {
    let isPivot = true;
    for (let k = 1; k <= wing; k++) {
      if (candles[i - k].high >= candles[i].high || candles[i + k].high >= candles[i].high) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) out.push(i);
  }
  return out;
}

export function findSwingLows(candles: Candle[], wing = 2): number[] {
  const out: number[] = [];
  for (let i = wing; i < candles.length - wing; i++) {
    let isPivot = true;
    for (let k = 1; k <= wing; k++) {
      if (candles[i - k].low <= candles[i].low || candles[i + k].low <= candles[i].low) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) out.push(i);
  }
  return out;
}

/** Structure read over the last `lookback` candles. Compression collapses to 'range'. */
export function classifyTrend(candles: Candle[], atr: number, lookback = 20): TrendState {
  const closed = candles.filter((c) => c.complete);
  const slice = closed.slice(-lookback);
  if (slice.length < 8) return 'range';

  const span = Math.max(...slice.map((c) => c.high)) - Math.min(...slice.map((c) => c.low));
  if (span < 1.5 * atr) return 'range'; // contracting, no directional edge

  const highs = findSwingHighs(slice).slice(-2).map((i) => slice[i].high);
  const lows = findSwingLows(slice).slice(-2).map((i) => slice[i].low);
  if (highs.length < 2 || lows.length < 2) return 'range';

  if (highs[1] > highs[0] && lows[1] > lows[0]) return 'up';
  if (highs[1] < highs[0] && lows[1] < lows[0]) return 'down';
  return 'range';
}

// ---------------------------------------------------------------------------
// RULE 1 (corrected) - 4H reversal, two stage, structure based
// ---------------------------------------------------------------------------

export interface ReversalResult {
  level: ReversalLevel;
  direction: BiasState; // direction of the reversal, 'neutral' when level is 'none'
  reason: string;
  levelToBreak?: number; // the swing that still has to give way for 'confirmed'
}

export interface ReversalOptions {
  priorRun?: number; // opposing closes required before a reversal can be read
  minBodyAtr?: number; // body size floor as a multiple of ATR(4H)
  wing?: number; // fractal wing for swing detection
}

/**
 * A single candle body is NOT a reversal. Two stages:
 *   'invalidated' - counter-trend body of real size after a run. Bias goes NEUTRAL.
 *   'confirmed'   - same, plus close beyond the last opposing swing (ChoCH). Bias flips.
 * Only closed candles are read, so nothing flips mid-candle.
 */
export function detect4hReversal(candles: Candle[], atr4h: number, opts: ReversalOptions = {}): ReversalResult {
  const { priorRun = 3, minBodyAtr = 0.5, wing = 2 } = opts;
  const closed = candles.filter((c) => c.complete);
  if (closed.length < priorRun + 2 * wing + 2) {
    return { level: 'none', direction: 'neutral', reason: 'insufficient closed 4H history' };
  }

  const signal = closed[closed.length - 1];
  const body = signal.close - signal.open;
  const dir: BiasState = body > 0 ? 'bullish' : body < 0 ? 'bearish' : 'neutral';
  if (dir === 'neutral') return { level: 'none', direction: 'neutral', reason: 'signal candle has no body' };

  if (Math.abs(body) < minBodyAtr * atr4h) {
    return { level: 'none', direction: 'neutral', reason: `body ${Math.abs(body).toFixed(5)} below ${minBodyAtr} x ATR floor` };
  }

  // the run has to oppose the signal candle
  const run = closed.slice(-(priorRun + 1), -1);
  const runOpposes = run.every((c) => (dir === 'bullish' ? c.close < c.open : c.close > c.open));
  if (!runOpposes) {
    return { level: 'none', direction: 'neutral', reason: `no ${priorRun}-candle opposing run before signal candle` };
  }

  const before = closed.slice(0, closed.length - 1);
  if (dir === 'bullish') {
    const swings = findSwingHighs(before, wing);
    if (!swings.length) return { level: 'invalidated', direction: 'bullish', reason: 'counter-trend body, no swing high to reference' };
    const level = before[swings[swings.length - 1]].high;
    return signal.close > level
      ? { level: 'confirmed', direction: 'bullish', reason: `4H closed ${signal.close} above swing high ${level} (ChoCH)`, levelToBreak: level }
      : { level: 'invalidated', direction: 'bullish', reason: `4H bullish body but close ${signal.close} still below swing high ${level}`, levelToBreak: level };
  }

  const swings = findSwingLows(before, wing);
  if (!swings.length) return { level: 'invalidated', direction: 'bearish', reason: 'counter-trend body, no swing low to reference' };
  const level = before[swings[swings.length - 1]].low;
  return signal.close < level
    ? { level: 'confirmed', direction: 'bearish', reason: `4H closed ${signal.close} below swing low ${level} (ChoCH)`, levelToBreak: level }
    : { level: 'invalidated', direction: 'bearish', reason: `4H bearish body but close ${signal.close} still above swing low ${level}`, levelToBreak: level };
}

// ---------------------------------------------------------------------------
// RULE 2 - recomputeMtfBias, runs fresh on every scan
// ---------------------------------------------------------------------------

export interface LadderInput {
  weekly: BiasState;
  daily: BiasState;
  fourH: { trend: TrendState; reversal: ReversalResult };
  oneH: BiasState;
  fifteenM: BiasState;
  computedAt: number; // epoch ms, stamped by the caller for audit
}

export interface MtfBiasResult {
  primaryBias: BiasState;
  alignmentScore: number; // how many of W / D / 4H / 1H agree, 0 to 4
  htfOpposed: boolean; // weekly AND daily both against the primary bias
  maxGrade: Grade;
  requireHtfZone: boolean;
  reason: string;
  computedAt: number;
}

/** No caching. Call this on every scan, before anything else. */
export function recomputeMtfBias(l: LadderInput): MtfBiasResult {
  const rev = l.fourH.reversal;

  let primaryBias: BiasState;
  let reason: string;

  if (rev.level === 'confirmed') {
    primaryBias = rev.direction;
    reason = `4H reversal confirmed: ${rev.reason}`;
  } else if (rev.level === 'invalidated') {
    primaryBias = 'neutral';
    reason = `4H structure invalidated but not confirmed: ${rev.reason}. No setups until 4H closes beyond ${rev.levelToBreak}.`;
  } else {
    primaryBias = l.fourH.trend === 'up' ? 'bullish' : l.fourH.trend === 'down' ? 'bearish' : 'neutral';
    reason = `4H trend ${l.fourH.trend}, no reversal signal`;
  }

  const fourHBias: BiasState = rev.level === 'confirmed' ? rev.direction : l.fourH.trend === 'up' ? 'bullish' : l.fourH.trend === 'down' ? 'bearish' : 'neutral';
  const alignmentScore = [l.weekly, l.daily, fourHBias, l.oneH].filter((b) => b === primaryBias && b !== 'neutral').length;

  const htfOpposed = primaryBias !== 'neutral' && l.weekly === opposite(primaryBias) && l.daily === opposite(primaryBias);

  let maxGrade: Grade = 'A+';
  if (htfOpposed) {
    maxGrade = 'C';
    reason += '. Weekly and Daily both opposed, grade capped at C and entry must sit at an HTF zone.';
  }
  if (primaryBias === 'neutral') maxGrade = 'F';

  return { primaryBias, alignmentScore, htfOpposed, maxGrade, requireHtfZone: htfOpposed, reason, computedAt: l.computedAt };
}

// ---------------------------------------------------------------------------
// RULE 3 - order flow confirms or degrades, never sets the bias
// ---------------------------------------------------------------------------

export interface OrderFlowInput {
  cvdSlopeZ: number; // CVD slope over the window, normalised by its own stdev
  priceSlopeZ: number; // price slope over the same window, same normalisation
  price: number;
  poc: number;
  vah: number;
  val: number;
  volumeSource: 'true' | 'tick';
  threshold?: number; // z floor, default 1.0
}

export interface OrderFlowResult {
  bias: BiasState;
  confidence: 'high' | 'low';
  reason: string;
}

/**
 * Divergence is checked FIRST because it is the highest information state:
 * CVD rising into stalling price is absorption, and absorption is bearish.
 * Acceptance uses the value area edges, not the POC. Price above POC but inside
 * value is not acceptance.
 */
export function orderFlowBias(i: OrderFlowInput): OrderFlowResult {
  const t = i.threshold ?? 1.0;
  const confidence: 'high' | 'low' = i.volumeSource === 'true' ? 'high' : 'low';

  if (i.cvdSlopeZ > t && i.priceSlopeZ < -t) {
    return { bias: 'bearish', confidence, reason: 'CVD rising into falling price: buyers being absorbed' };
  }
  if (i.cvdSlopeZ < -t && i.priceSlopeZ > t) {
    return { bias: 'bullish', confidence, reason: 'CVD falling into rising price: sellers being absorbed' };
  }
  if (i.cvdSlopeZ > t && i.price > i.vah) {
    return { bias: 'bullish', confidence, reason: `CVD rising and price accepted above VAH ${i.vah}` };
  }
  if (i.cvdSlopeZ < -t && i.price < i.val) {
    return { bias: 'bearish', confidence, reason: `CVD falling and price accepted below VAL ${i.val}` };
  }
  return { bias: 'neutral', confidence, reason: 'no CVD conviction or price still inside the value area' };
}

/** Corrected imbalance read. Location and mitigation decide it, not the stack's own direction. */
export function imbalanceRead(stack: ImbalanceStack, price: number): 'support' | 'resistance' | 'neutral' {
  const above = price > stack.top;
  const below = price < stack.bottom;
  if (stack.direction === 'sell') {
    if (stack.tradedThrough && above) return 'support'; // sellers absorbed, shorts trapped
    if (!stack.tradedThrough && below) return 'resistance'; // untouched supply overhead
    return 'neutral';
  }
  if (stack.tradedThrough && below) return 'resistance'; // buyers absorbed
  if (!stack.tradedThrough && above) return 'support';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// RULE 4 - zones are entry anchors only
// ---------------------------------------------------------------------------

export interface EntryZoneResult {
  ok: boolean;
  zone?: Zone;
  entry?: number;
  distanceAtr?: number;
  message: string;
}

/**
 * Long entries only from bullish zones BELOW price, shorts only from bearish zones
 * ABOVE price. 'filled' zones are skipped, 'testing' zones are allowed because that
 * is the live trigger the v2 FVG Limit Protocol is built on.
 */
export function validEntryZone(
  bias: BiasState,
  zones: Zone[],
  price: number,
  atr4h: number,
  cfg: InstrumentConfig,
): EntryZoneResult {
  if (bias === 'neutral') return { ok: false, message: 'Bias neutral. No entry in either direction.' };

  const wantDirection = bias === 'bullish' ? 'bullish' : 'bearish';
  const usable = zones.filter((z) => z.direction === wantDirection && z.state !== 'filled');

  const sided = bias === 'bullish'
    ? usable.filter((z) => z.top <= price || z.state === 'testing').sort((a, b) => b.top - a.top)
    : usable.filter((z) => z.bottom >= price || z.state === 'testing').sort((a, b) => a.bottom - b.bottom);

  if (!sided.length) {
    return { ok: false, message: bias === 'bullish' ? 'No valid long entry, wait for pullback' : 'No valid short entry, wait for rally' };
  }

  const zone = sided[0];
  const entry = bias === 'bullish' ? zone.top - cfg.entryBuffer : zone.bottom + cfg.entryBuffer;
  const distanceAtr = Math.abs(price - entry) / atr4h;

  if (distanceAtr > cfg.maxEntryDistanceAtr) {
    return {
      ok: false,
      zone,
      entry,
      distanceAtr,
      message: `Nearest ${wantDirection} zone is ${distanceAtr.toFixed(2)}x ATR away, beyond the ${cfg.maxEntryDistanceAtr}x gate. ${bias === 'bullish' ? 'Wait for pullback' : 'Wait for rally'}.`,
    };
  }

  return { ok: true, zone, entry, distanceAtr, message: `Entry ${entry} at ${zone.state} ${zone.direction} ${zone.type}` };
}

export function computeStop(zone: Zone, bias: BiasState, atr4h: number, cfg: InstrumentConfig): number {
  const buffer = cfg.stopBufferAtr * atr4h;
  return bias === 'bullish' ? zone.bottom - buffer : zone.top + buffer;
}

/** Nearest liquidity beyond entry, in the direction of the trade. */
export function pickTargets(bias: BiasState, entry: number, liquidity: number[]): number[] {
  const beyond = bias === 'bullish' ? liquidity.filter((l) => l > entry).sort((a, b) => a - b) : liquidity.filter((l) => l < entry).sort((a, b) => b - a);
  return beyond.slice(0, 2);
}

export function rr(entry: number, stop: number, target: number): number {
  const risk = Math.abs(entry - stop);
  return risk === 0 ? 0 : Math.abs(target - entry) / risk;
}

// ---------------------------------------------------------------------------
// RULE 5 - 15m is timing, never direction
// ---------------------------------------------------------------------------

export interface ConfirmationResult {
  status: 'confirmed' | 'pending';
  gradeDelta: number;
  note: string;
}

export function applyConfirmation(primaryBias: BiasState, fifteenM: BiasState): ConfirmationResult {
  if (fifteenM === primaryBias) return { status: 'confirmed', gradeDelta: 0, note: '15m aligned with primary bias' };
  const want = primaryBias === 'bullish' ? 'bullish' : 'bearish';
  return {
    status: 'pending',
    gradeDelta: -1,
    note: `15m is ${fifteenM}, not confirming. Wait for 15m BOS/ChoCH ${want} before entering. Direction is unchanged.`,
  };
}

// ---------------------------------------------------------------------------
// composer
// ---------------------------------------------------------------------------

export interface ScanInput {
  instrument: string;
  price: number;
  atr4h: number;
  candles4h: Candle[];
  zones: Zone[];
  liquidity: number[];
  orderFlow: Omit<OrderFlowInput, 'volumeSource'>;
  imbalances?: ImbalanceStack[];
  ladder: Omit<LadderInput, 'fourH'> & { fourH?: Partial<LadderInput['fourH']> };
  baseGrade: Grade; // from the existing 12-point v2 rubric
  override?: { entry?: number; stop?: number; targets?: number[] }; // for regression tests only
}

export interface ScanResult {
  bias: BiasState;
  grade: Grade;
  status: 'READY TO PLACE LIMIT' | 'PENDING CONFIRMATION' | 'NO SETUP';
  entry?: number;
  stop?: number;
  targets?: number[];
  rrToTp1?: number;
  zone?: Zone;
  mtf: MtfBiasResult;
  orderFlow: OrderFlowResult;
  confirmation: ConfirmationResult;
  notes: string[];
}

export function gradeScan(input: ScanInput): ScanResult {
  const { cfg, known } = getInstrumentConfig(input.instrument);
  const notes: string[] = [];
  if (!known) {
    notes.push(`No tuned config for ${input.instrument}. Using conservative defaults (1.0x ATR entry gate, 0.75x ATR stop buffer). Add it to INSTRUMENTS before promoting it.`);
  }

  // RULE 6: everything below is recomputed from live data on every call.
  const reversal = input.ladder.fourH?.reversal ?? detect4hReversal(input.candles4h, input.atr4h);
  const trend = input.ladder.fourH?.trend ?? classifyTrend(input.candles4h, input.atr4h);
  const mtf = recomputeMtfBias({ ...input.ladder, fourH: { trend, reversal } });
  const of = orderFlowBias({ ...input.orderFlow, volumeSource: cfg.volumeSource });
  const confirmation = applyConfirmation(mtf.primaryBias, input.ladder.fifteenM);

  notes.push(mtf.reason);
  notes.push(`Order flow: ${of.bias} (${of.confidence} confidence, ${cfg.volumeSource} volume). ${of.reason}`);
  if (cfg.volumeSource === 'tick') {
    notes.push('FX volume is broker tick volume, not exchange volume. Order flow is a proxy here and only modifies the grade.');
  }
  for (const stack of input.imbalances ?? []) {
    notes.push(`${stack.direction} imbalance ${stack.bottom}-${stack.top} reads as ${imbalanceRead(stack, input.price)}`);
  }

  if (mtf.primaryBias === 'neutral') {
    return { bias: 'neutral', grade: 'F', status: 'NO SETUP', mtf, orderFlow: of, confirmation, notes };
  }

  const zoneResult = validEntryZone(mtf.primaryBias, input.zones, input.price, input.atr4h, cfg);
  if (!zoneResult.ok || !zoneResult.zone || zoneResult.entry === undefined) {
    notes.push(zoneResult.message);
    return { bias: mtf.primaryBias, grade: 'F', status: 'NO SETUP', mtf, orderFlow: of, confirmation, notes };
  }

  const entry = input.override?.entry ?? zoneResult.entry;
  const stop = input.override?.stop ?? computeStop(zoneResult.zone, mtf.primaryBias, input.atr4h, cfg);
  const targets = input.override?.targets ?? pickTargets(mtf.primaryBias, entry, input.liquidity);

  let grade = input.baseGrade;
  grade = capGrade(grade, mtf.maxGrade);

  // order flow opposing the trade direction
  if (of.bias !== 'neutral' && of.bias !== mtf.primaryBias) {
    if (of.confidence === 'high') {
      grade = capGrade(grade, 'C');
      notes.push('Order flow opposes the setup direction on true volume. Grade capped at C.');
    } else {
      grade = shiftGrade(grade, -1);
      notes.push('Order flow opposes the setup direction on tick volume. Grade dropped one letter.');
    }
  }

  grade = shiftGrade(grade, confirmation.gradeDelta);
  if (confirmation.gradeDelta !== 0) notes.push(confirmation.note);

  const rrToTp1 = targets.length ? rr(entry, stop, targets[0]) : 0;
  if (rrToTp1 < cfg.minRR) {
    grade = capGrade(grade, 'C');
    notes.push(`R:R to TP1 is ${rrToTp1.toFixed(2)}, below the ${cfg.minRR}:1 floor. Grade capped at C.`);
  }

  if (zoneResult.distanceAtr !== undefined && zoneResult.distanceAtr > 1.0) {
    grade = capGrade(grade, 'A');
    notes.push(`Entry ${zoneResult.distanceAtr.toFixed(2)}x ATR from price, no A+ available.`);
  }

  return {
    bias: mtf.primaryBias,
    grade,
    status: confirmation.status === 'confirmed' ? 'READY TO PLACE LIMIT' : 'PENDING CONFIRMATION',
    entry,
    stop,
    targets,
    rrToTp1,
    zone: zoneResult.zone,
    mtf,
    orderFlow: of,
    confirmation,
    notes,
  };
}

// ---------------------------------------------------------------------------
// RULE 6 - context hygiene. This is where the 09-03 bias lock actually lived.
// ---------------------------------------------------------------------------

export const AUTHORITATIVE_BIAS_DIRECTIVE = `
AUTHORITATIVE BIAS BLOCK
The bias below was computed in code from the current closed candles. It is not a suggestion.
You may not output a setup against it, and you may not restate a bias from an earlier turn.
Any directional read in earlier messages in this thread is VOID. Recompute your narrative
from the block below only. If the block says NEUTRAL, output no setup.
`.trim();

export function buildScanContext(result: ScanResult, instrument: string, price: number): string {
  return [
    AUTHORITATIVE_BIAS_DIRECTIVE,
    '',
    `INSTRUMENT: ${instrument}`,
    `PRICE: ${price}`,
    `COMPUTED_AT: ${new Date(result.mtf.computedAt).toISOString()}`,
    `PRIMARY_BIAS: ${result.bias.toUpperCase()}`,
    `ALIGNMENT: ${result.mtf.alignmentScore}/4`,
    `MAX_GRADE: ${result.mtf.maxGrade}`,
    `GRADE: ${result.grade}`,
    `STATUS: ${result.status}`,
    `ENTRY: ${result.entry ?? 'n/a'}`,
    `STOP: ${result.stop ?? 'n/a'}`,
    `TARGETS: ${(result.targets ?? []).join(', ') || 'n/a'}`,
    `RR_TP1: ${result.rrToTp1?.toFixed(2) ?? 'n/a'}`,
    `ORDER_FLOW: ${result.orderFlow.bias} (${result.orderFlow.confidence})`,
    `CONFIRMATION: ${result.confirmation.status}`,
    '',
    'NOTES:',
    ...result.notes.map((n) => `- ${n}`),
  ].join('\n');
}

const SCAN_MARKER = 'TRADEMIND ANALYSIS';

/**
 * Strips prior scan outputs from the thread. On 09-03 the model stayed short partly
 * because it could read its own three earlier SHORT verdicts in the history.
 */
export function voidPriorScans<T extends { role: string; content: string }>(messages: T[]): T[] {
  return messages.map((m) =>
    m.role === 'assistant' && m.content.includes(SCAN_MARKER)
      ? { ...m, content: '[prior scan output removed. The bias in that scan is void.]' }
      : m,
  );
}
