/**
 * Acceptance tests for the v3 bias engine.
 * Test 1 is the GBP/USD case from the 2026-09-03 incident report, with the stop and
 * targets corrected so that it passes the platform's own R:R and stop-buffer rules.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  Candle, Zone, Grade, ScanInput,
  detect4hReversal, classifyTrend, recomputeMtfBias, orderFlowBias, imbalanceRead,
  validEntryZone, gradeScan, voidPriorScans, shiftGrade, capGrade, INSTRUMENTS,
  getInstrumentConfig, DEFAULT_CONFIG,
} from '@/lib/agents/biasEngine';

const ATR = 0.0050; // GBP/USD 4H ATR, 50 pips
const NOW = 1756900000000;

const c = (o: number, h: number, l: number, cl: number, i: number): Candle => ({
  time: NOW - (12 - i) * 4 * 3600_000, open: o, high: h, low: l, close: cl, complete: true,
});

/** Downtrend, swing high at 1.3495, three bearish 4H closes, then a bullish close
 *  at 1.3500 that breaks the swing high. This is a confirmed ChoCH. */
const CONFIRMED_REVERSAL: Candle[] = [
  c(1.3540, 1.3545, 1.3520, 1.3525, 0),
  c(1.3525, 1.3530, 1.3495, 1.3500, 1),
  c(1.3500, 1.3505, 1.3465, 1.3470, 2),
  c(1.3470, 1.3480, 1.3460, 1.3475, 3),
  c(1.3475, 1.3488, 1.3470, 1.3485, 4),
  c(1.3485, 1.3495, 1.3478, 1.3492, 5), // swing high 1.3495
  c(1.3492, 1.3493, 1.3470, 1.3474, 6), // bearish 1
  c(1.3474, 1.3478, 1.3455, 1.3460, 7), // bearish 2
  c(1.3460, 1.3465, 1.3440, 1.3448, 8), // bearish 3
  c(1.3448, 1.3505, 1.3445, 1.3500, 9), // bullish body 52 pips, closes above 1.3495
];

/** Same three bearish closes and the same bullish candle, but the last swing high is
 *  far above at 1.3640, so nothing structural has broken. */
const UNCONFIRMED_BOUNCE: Candle[] = CONFIRMED_REVERSAL.map((k, i) =>
  i === 5 ? { ...k, high: 1.3640 } : k,
);

const BULLISH_OB: Zone = { type: 'OB', direction: 'bullish', top: 1.3490, bottom: 1.3475, state: 'fresh' };

const baseScan = (over: Partial<ScanInput> = {}): ScanInput => ({
  instrument: 'GBP_USD',
  price: 1.3510,
  atr4h: ATR,
  candles4h: CONFIRMED_REVERSAL,
  zones: [BULLISH_OB],
  liquidity: [1.3575, 1.3620],
  orderFlow: { cvdSlopeZ: 1.8, priceSlopeZ: 1.2, price: 1.3510, poc: 1.3480, vah: 1.3500, val: 1.3460 },
  ladder: { weekly: 'bearish', daily: 'bullish', oneH: 'bullish', fifteenM: 'bearish', computedAt: NOW },
  baseGrade: 'A' as Grade,
  ...over,
});

// ---------------------------------------------------------------------------

test('1. incident test case: 4H ChoCH flips bias long, 15m lag downgrades but does not flip', () => {
  const r = gradeScan(baseScan());

  assert.equal(r.bias, 'bullish', 'bias must be long, not the stale short');
  assert.equal(r.grade, 'B', 'A downgraded one letter for the unconfirmed 15m');
  assert.equal(r.status, 'PENDING CONFIRMATION');
  assert.equal(r.entry, 1.3490, 'buy limit at the top of the bullish OB');
  assert.ok(Math.abs(r.stop! - 1.3450) < 1e-9, 'stop is OB bottom minus 0.5x ATR, not 5 pips under the block');
  assert.deepEqual(r.targets, [1.3575, 1.3620]);
  assert.ok(r.rrToTp1! >= INSTRUMENTS.GBP_USD.minRR, `R:R to TP1 was ${r.rrToTp1}, must clear the 2:1 floor`);
  assert.match(r.confirmation.note, /Wait for 15m BOS\/ChoCH bullish/);
});

test('2. a bullish 4H body that does not break the swing high goes NEUTRAL, not long', () => {
  const rev = detect4hReversal(UNCONFIRMED_BOUNCE, ATR);
  assert.equal(rev.level, 'invalidated');
  assert.equal(rev.levelToBreak, 1.3640);

  const r = gradeScan(baseScan({ candles4h: UNCONFIRMED_BOUNCE }));
  assert.equal(r.bias, 'neutral', 'one green candle in a downtrend is not a reversal');
  assert.equal(r.status, 'NO SETUP');
  assert.equal(r.grade, 'F');
});

test('3. order flow degrades the grade and never sets the direction', () => {
  // CVD rising into falling price: buyers absorbed, a bearish read against a long setup
  const r = gradeScan(baseScan({
    orderFlow: { cvdSlopeZ: 1.8, priceSlopeZ: -1.5, price: 1.3510, poc: 1.3480, vah: 1.3500, val: 1.3460 },
    ladder: { weekly: 'bearish', daily: 'bullish', oneH: 'bullish', fifteenM: 'bullish', computedAt: NOW },
  }));

  assert.equal(r.orderFlow.bias, 'bearish');
  assert.equal(r.bias, 'bullish', 'order flow must not flip the bias');
  assert.equal(r.grade, 'B', 'A dropped one letter on opposing tick-volume order flow');
});

test('4. the original acceptance numbers fail the platform R:R floor', () => {
  const r = gradeScan(baseScan({ override: { entry: 1.3490, stop: 1.3470, targets: [1.3520, 1.3550] } }));
  assert.ok(r.rrToTp1! < 2, `original numbers give ${r.rrToTp1?.toFixed(2)}R to TP1`);
  assert.equal(r.grade, 'C', 'cannot grade B on a 1.5R first target');
});

test('5. filled zones are skipped, and a zone beyond the ATR gate means wait', () => {
  const r = gradeScan(baseScan({
    zones: [
      { ...BULLISH_OB, state: 'filled' },
      { type: 'FVG', direction: 'bullish', top: 1.3400, bottom: 1.3390, state: 'fresh' },
    ],
  }));
  assert.equal(r.status, 'NO SETUP');
  assert.ok(r.notes.some((n) => /Wait for pullback/i.test(n)), 'should tell the trader to wait, not force an entry');
});

test('6. a zone being tested right now is a live trigger, not a dead zone', () => {
  const z = validEntryZone('bullish', [{ ...BULLISH_OB, state: 'testing' }], 1.3482, ATR, INSTRUMENTS.GBP_USD);
  assert.equal(z.ok, true, 'price inside the zone is when the v2 FVG limit protocol fires');
  assert.equal(z.entry, 1.3490);
});

test('7. wrong-side zones are never used as entry anchors', () => {
  const bearishOBAbove: Zone = { type: 'OB', direction: 'bearish', top: 1.3505, bottom: 1.3495, state: 'fresh' };
  const z = validEntryZone('bullish', [bearishOBAbove], 1.3480, ATR, INSTRUMENTS.GBP_USD);
  assert.equal(z.ok, false);
  assert.match(z.message, /wait for pullback/i);
});

test('8. stacked imbalances read by location and mitigation, not by their own direction', () => {
  const stack = { direction: 'sell' as const, top: 1.3490, bottom: 1.3475, tradedThrough: true };
  assert.equal(imbalanceRead(stack, 1.3510), 'support', 'price rose through it, those sellers were absorbed');
  const overhead = { direction: 'sell' as const, top: 1.3560, bottom: 1.3545, tradedThrough: false };
  assert.equal(imbalanceRead(overhead, 1.3510), 'resistance', 'untouched supply overhead is not bullish fuel');
});

test('9. weekly and daily both opposed caps the grade at C but keeps the direction', () => {
  const m = recomputeMtfBias({
    weekly: 'bearish', daily: 'bearish', oneH: 'bullish', fifteenM: 'bullish', computedAt: NOW,
    fourH: { trend: 'up', reversal: detect4hReversal(CONFIRMED_REVERSAL, ATR) },
  });
  assert.equal(m.primaryBias, 'bullish');
  assert.equal(m.htfOpposed, true);
  assert.equal(m.maxGrade, 'C');
});

test('10. prior scan verdicts are voided so a stale bias cannot re-enter via the transcript', () => {
  const msgs = [
    { role: 'user', content: 'scan GBPUSD' },
    { role: 'assistant', content: '📊 TRADEMIND ANALYSIS - GBP/USD 1H\nBIAS: SHORT\nGRADE: A' },
    { role: 'user', content: 'the last 4H candle is bullish' },
  ];
  const cleaned = voidPriorScans(msgs);
  assert.ok(!cleaned[1].content.includes('SHORT'));
  assert.match(cleaned[1].content, /void/);
});

test('11. grade arithmetic clamps and caps correctly', () => {
  assert.equal(shiftGrade('A+', -1), 'A');
  assert.equal(shiftGrade('F', -3), 'F');
  assert.equal(shiftGrade('A+', 5), 'A+');
  assert.equal(capGrade('A', 'C'), 'C');
  assert.equal(capGrade('D', 'C'), 'D');
});

test('12. trend classification collapses to range under compression', () => {
  const flat = Array.from({ length: 12 }, (_, i) => c(1.3500, 1.3505, 1.3495, 1.3500, i));
  assert.equal(classifyTrend(flat, ATR), 'range');
});

// ---------------------------------------------------------------------------
// instrument coverage: the rules are identical everywhere, only constants change
// ---------------------------------------------------------------------------

/** Same structure as the GBP/USD fixture, rescaled to NAS100 prices. */
const nasCandle = (o: number, h: number, l: number, cl: number, i: number): Candle =>
  ({ time: NOW - (12 - i) * 4 * 3600_000, open: o, high: h, low: l, close: cl, complete: true });

const NAS_REVERSAL: Candle[] = [
  nasCandle(20400, 20420, 20340, 20350, 0),
  nasCandle(20350, 20360, 20200, 20210, 1),
  nasCandle(20210, 20230, 20100, 20110, 2),
  nasCandle(20110, 20150, 20080, 20140, 3),
  nasCandle(20140, 20180, 20120, 20170, 4),
  nasCandle(20170, 20200, 20150, 20190, 5), // swing high 20200
  nasCandle(20190, 20195, 20100, 20110, 6), // bearish 1
  nasCandle(20110, 20130, 20020, 20040, 7), // bearish 2
  nasCandle(20040, 20050, 19940, 19960, 8), // bearish 3
  nasCandle(19960, 20260, 19950, 20250, 9), // bullish, closes above 20200
];

test('13. the same rules produce the same behaviour on NAS100', () => {
  const r = gradeScan({
    instrument: 'NAS100',
    price: 20280,
    atr4h: 180,
    candles4h: NAS_REVERSAL,
    zones: [{ type: 'OB', direction: 'bullish', top: 20240, bottom: 20180, state: 'fresh' }],
    liquidity: [20600, 20900],
    orderFlow: { cvdSlopeZ: 1.6, priceSlopeZ: 1.1, price: 20280, poc: 20150, vah: 20230, val: 20050 },
    ladder: { weekly: 'bearish', daily: 'bullish', oneH: 'bullish', fifteenM: 'bearish', computedAt: NOW },
    baseGrade: 'A' as Grade,
  });

  assert.equal(r.bias, 'bullish', 'ChoCH detection is not FX-specific');
  assert.equal(r.grade, 'B', 'same one-letter penalty for the unconfirmed 15m');
  assert.equal(r.status, 'PENDING CONFIRMATION');
  assert.equal(r.entry, 20235, 'OB top minus the NAS 5-point spread buffer');
});

test('14. NAS100 carries the widened 1.3x ATR entry gate from the v2 NAS note', () => {
  assert.equal(INSTRUMENTS.NAS100.maxEntryDistanceAtr, 1.95);
  assert.equal(INSTRUMENTS.SPX500.maxEntryDistanceAtr, 1.5);
});

test('15. an unknown symbol falls back conservatively, it does not borrow GBP/USD', () => {
  const { cfg, known } = getInstrumentConfig('SOL_USD');
  assert.equal(known, false);
  assert.equal(cfg.stopBufferAtr, DEFAULT_CONFIG.stopBufferAtr, 'wider stop buffer');
  assert.equal(cfg.maxEntryDistanceAtr, 1.0, 'tighter entry gate than any tuned instrument');
  assert.notEqual(cfg.entryBuffer, INSTRUMENTS.SPX500.entryBuffer);

  const r = gradeScan(baseScan({ instrument: 'SOL_USD' }));
  assert.ok(r.notes.some((n) => /No tuned config for SOL_USD/.test(n)), 'must warn, not fail silently');
});

test('16. every instrument in the table is self-consistent', () => {
  for (const [key, cfg] of Object.entries(INSTRUMENTS)) {
    assert.equal(cfg.symbol, key, `${key} symbol field must match its key`);
    assert.ok(cfg.stopBufferAtr >= 0.5, `${key} stop buffer below the 0.5x ATR floor`);
    assert.ok(cfg.minRR >= 2, `${key} R:R floor below 2:1`);
    assert.ok(cfg.entryBuffer >= 0, `${key} negative entry buffer`);
  }
});
