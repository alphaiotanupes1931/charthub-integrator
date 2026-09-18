/**
 * Read-only measurement of the entry-fill complaint.
 *
 * Marcus's report is "price goes straight through my entry to the stop, never in
 * profit for 5 minutes". That sentence hides three different failures, and each
 * needs its own number before any rule changes:
 *
 *  1. ORDER TYPE. Today a planned entry is a resting limit at the level. The claim
 *     is that every one of them should have been a stop order taken as price
 *     leaves the level. Both are replayed here from the same bars so the answer is
 *     a measurement, not a preference.
 *
 *  2. THE EXPIRY CLOCK. Signals are closed as expired while still live. The
 *     measured bars-to-resolution distribution per instrument says how long a
 *     setup actually needs, so the hold window can be set from data.
 *
 *  3. FIRST-BAR FILLS. A win that lands on its first bar with no adverse move
 *     usually means the entry price was already gone when the signal was filed.
 *     Measured here as the gap between the planned entry and where price actually
 *     was on the first bar after filing.
 *
 * Nothing in this module writes to the database and nothing changes production
 * behaviour. It reports.
 */

import type { ReplayBar } from "@/lib/signal-replay";
import { replayDirection, forwardBars } from "@/lib/signal-replay";
import { costInR } from "@/lib/trading-costs";

export type FillTestSignal = {
  id: string;
  symbol: string;
  timeframe: string;
  bias: string;
  grade: string;
  entry: number;
  stop: number;
  tp1: number;
  status: string;
  created_at: string;
};

export type EntryMode = "limit" | "stop" | "stop-slipped";

/** One outcome bucket: the population that filled under a given order type. */
export type FillOutcome = {
  mode: EntryMode;
  /** Signals where the order would have been triggered at all. */
  filled: number;
  /** Signals whose order never triggered inside the walk window. */
  unfilled: number;
  target: number;
  stopped: number;
  /** Filled but neither level printed before the bars ran out. */
  openAtEnd: number;
  decided: number;
  hitRate: number | null;
  grossExpectancyR: number | null;
  netExpectancyR: number | null;
  avgBarsToFill: number | null;
  avgBarsToResolve: number | null;
};

export type PerInstrument = {
  symbol: string;
  n: number;
  limit: FillOutcome;
  stop: FillOutcome;
  /** Stop entry priced at where the market actually was, not at the level. */
  stopSlipped: FillOutcome;
  /** Positive means the stop entry produced more net R per decided trade. */
  netEdgeToStopEntry: number | null;
  /** The same comparison once the stale fill price is paid for. */
  netEdgeToStopEntrySlipped: number | null;
};

export type ExpiryClock = {
  symbol: string;
  timeframe: string;
  resolved: number;
  medianBarsToResolve: number | null;
  p90BarsToResolve: number | null;
  maxBarsToResolve: number | null;
  /** Bars to cover 90% of resolutions — the hold window this data supports. */
  recommendedHoldBars: number | null;
};

export type FirstBarRead = {
  /** Signals resolved on the very first bar after filing. */
  resolvedOnFirstBar: number;
  /** Of those, how many were wins with no adverse move at all. */
  freeWins: number;
  /** Signals whose first bar had already left the planned entry behind. */
  entryAlreadyGone: number;
  /** Median distance, in R, price sat past the entry on the first bar. */
  medianGoneByR: number | null;
  /** How many would be refused at each candidate tolerance. */
  refusedAtTolerance: Array<{ toleranceR: number; refused: number; share: number }>;
};

/**
 * What the record would look like if we refused to publish a signal whose entry
 * price had already gone by more than `toleranceR` at the moment of filing.
 *
 * Staleness is measured against the last close before filing, because that is the
 * price the scanner itself can see when it decides. Survivors are then scored on
 * the limit entry, which is what production actually files.
 */
export type ToleranceCohort = {
  toleranceR: number;
  survivors: number;
  refused: number;
  /** Share of today's published volume that would be refused. */
  refusedShare: number;
  decided: number;
  hitRate: number | null;
  grossExpectancyR: number | null;
  netExpectancyR: number | null;
  /** First-bar resolutions left inside the surviving population. */
  resolvedOnFirstBar: number;
};

export type EntryFillReport = {
  scanned: number;
  scorable: number;
  unrecoverable: number;
  overall: {
    limit: FillOutcome;
    stop: FillOutcome;
    stopSlipped: FillOutcome;
    netEdgeToStopEntry: number | null;
    netEdgeToStopEntrySlipped: number | null;
    medianSlippagePaidR: number | null;
  };
  byInstrument: PerInstrument[];
  expiryClock: ExpiryClock[];
  firstBar: FirstBarRead;
  toleranceCohorts: ToleranceCohort[];
  verdicts: string[];
  caveats: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[idx]!;
}

type Trial = {
  filled: boolean;
  barsToFill: number | null;
  status: "target" | "stop" | "open";
  grossR: number | null;
  netR: number | null;
  barsToResolve: number | null;
  /** Price the order is assumed to be filled at, which is not always the level. */
  fillPrice: number | null;
  /** How far past the planned level the assumed fill sat, in planned R. */
  slippageR: number | null;
};

const unfilled = (): Trial => ({
  filled: false,
  barsToFill: null,
  status: "open",
  grossR: null,
  netR: null,
  barsToResolve: null,
  fillPrice: null,
  slippageR: null,
});

/** Last closed bar at or before the moment the signal was filed. */
function priorClose(bars: ReplayBar[], createdAt: string): number | null {
  const t = new Date(createdAt).getTime();
  let close: number | null = null;
  for (const bar of bars) {
    if (bar.time * 1000 <= t) close = bar.close;
    else break;
  }
  return close;
}

/**
 * Replay one signal under one order type.
 *
 * limit: fills when price trades BACK to the level (a long fills on a low at or
 *   below entry).
 * stop: fills when price trades THROUGH the level in the direction of the trade
 *   (a long fills on a high at or above entry), assumed filled at the level.
 * stop-slipped: the same trigger, but when the level was ALREADY behind price
 *   before that bar opened, the fill is moved to that earlier close instead of the
 *   level. This is the honest version for a signal filed after price had already
 *   left the zone: the account cannot buy at a price that has gone. Risk is
 *   recomputed from the worse fill, so R shrinks, and if the target was already
 *   reached the trade counts as never available.
 *
 * All modes walk on from the filling bar inclusive, and a bar holding both the
 * stop and the target counts as a stop because intrabar sequence is not visible.
 */
export function trialEntry(sig: FillTestSignal, bars: ReplayBar[], mode: EntryMode): Trial | null {
  const direction = replayDirection(sig.bias);
  const plannedRisk = Math.abs(sig.entry - sig.stop);
  if (!direction || !(plannedRisk > 0)) return null;

  const forward = forwardBars(bars, sig.created_at);
  if (!forward.length) return null;

  const long = direction === "long";

  let fillIndex = -1;
  for (let i = 0; i < forward.length; i++) {
    const bar = forward[i]!;
    const touched =
      mode === "limit"
        ? long
          ? bar.low <= sig.entry
          : bar.high >= sig.entry
        : long
          ? bar.high >= sig.entry
          : bar.low <= sig.entry;
    if (touched) {
      fillIndex = i;
      break;
    }
  }

  if (fillIndex === -1) return unfilled();

  let fillPrice = sig.entry;
  if (mode === "stop-slipped") {
    const reference = fillIndex > 0 ? forward[fillIndex - 1]!.close : priorClose(bars, sig.created_at);
    if (reference != null && (long ? reference > sig.entry : reference < sig.entry)) {
      fillPrice = reference;
    }
  }

  const risk = Math.abs(fillPrice - sig.stop);
  const reward = long ? sig.tp1 - fillPrice : fillPrice - sig.tp1;
  // Price already past the target, or the fill already at or beyond the stop:
  // there was no trade left to take.
  if (!(risk > 0) || !(reward > 0)) return unfilled();

  const rMultiple = r2(reward / risk);
  const cost = costInR(sig.symbol, fillPrice, risk);
  const slippageR = r3(Math.abs(fillPrice - sig.entry) / plannedRisk);

  for (let i = fillIndex; i < forward.length; i++) {
    const bar = forward[i]!;
    const hitStop = long ? bar.low <= sig.stop : bar.high >= sig.stop;
    const hitTarget = long ? bar.high >= sig.tp1 : bar.low <= sig.tp1;
    if (hitStop || hitTarget) {
      const grossR = hitStop ? -1 : rMultiple;
      return {
        filled: true,
        barsToFill: fillIndex + 1,
        status: hitStop ? "stop" : "target",
        grossR,
        netR: r3(grossR - cost),
        barsToResolve: i - fillIndex + 1,
        fillPrice,
        slippageR,
      };
    }
  }

  return {
    filled: true,
    barsToFill: fillIndex + 1,
    status: "open",
    grossR: null,
    netR: null,
    barsToResolve: null,
    fillPrice,
    slippageR,
  };
}

function emptyOutcome(mode: EntryMode): FillOutcome & { _gross: number[]; _net: number[]; _fill: number[]; _res: number[] } {
  return {
    mode,
    filled: 0,
    unfilled: 0,
    target: 0,
    stopped: 0,
    openAtEnd: 0,
    decided: 0,
    hitRate: null,
    grossExpectancyR: null,
    netExpectancyR: null,
    avgBarsToFill: null,
    avgBarsToResolve: null,
    _gross: [],
    _net: [],
    _fill: [],
    _res: [],
  };
}

type Acc = ReturnType<typeof emptyOutcome>;

function addTrial(acc: Acc, t: Trial) {
  if (!t.filled) {
    acc.unfilled += 1;
    return;
  }
  acc.filled += 1;
  if (t.barsToFill != null) acc._fill.push(t.barsToFill);
  if (t.status === "open") {
    acc.openAtEnd += 1;
    return;
  }
  if (t.status === "target") acc.target += 1;
  else acc.stopped += 1;
  acc.decided += 1;
  if (t.grossR != null) acc._gross.push(t.grossR);
  if (t.netR != null) acc._net.push(t.netR);
  if (t.barsToResolve != null) acc._res.push(t.barsToResolve);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function seal(acc: Acc): FillOutcome {
  const { _gross, _net, _fill, _res, ...rest } = acc;
  const gross = avg(_gross);
  const net = avg(_net);
  const fill = avg(_fill);
  const res = avg(_res);
  return {
    ...rest,
    hitRate: rest.decided ? r3(rest.target / rest.decided) : null,
    grossExpectancyR: gross == null ? null : r3(gross),
    netExpectancyR: net == null ? null : r3(net),
    avgBarsToFill: fill == null ? null : r2(fill),
    avgBarsToResolve: res == null ? null : r2(res),
  };
}

const TOLERANCES = [0.1, 0.25, 0.5];

/**
 * Pure core. Given stored signals and a bar source, report on order type, hold
 * window and first-bar fills. No database access so it can be tested on
 * fabricated bars.
 */
export function runEntryFillTest(
  rows: FillTestSignal[],
  barsFor: (symbol: string, timeframe: string) => ReplayBar[] | null,
  minSample = 20,
): EntryFillReport {
  const overallLimit = emptyOutcome("limit");
  const overallStop = emptyOutcome("stop");
  const overallSlipped = emptyOutcome("stop-slipped");
  const perSymbol = new Map<string, { limit: Acc; stop: Acc; slipped: Acc; n: number }>();
  const clock = new Map<string, { symbol: string; timeframe: string; bars: number[] }>();

  let scorable = 0;
  let unrecoverable = 0;
  let resolvedOnFirstBar = 0;
  let freeWins = 0;
  let entryAlreadyGone = 0;
  const goneBy: number[] = [];
  const slippagePaid: number[] = [];
  // One cohort per candidate staleness tolerance, so the guard threshold is picked
  // from the trade-off between volume kept and honesty gained.
  const cohorts = new Map<number, { acc: Acc; survivors: number; refused: number; firstBar: number }>(
    TOLERANCES.map((t) => [t, { acc: emptyOutcome("limit"), survivors: 0, refused: 0, firstBar: 0 }]),
  );

  for (const row of rows) {
    const bars = barsFor(row.symbol, row.timeframe);
    if (!bars || !bars.length) {
      unrecoverable += 1;
      continue;
    }
    const limit = trialEntry(row, bars, "limit");
    const stopEntry = trialEntry(row, bars, "stop");
    const slipped = trialEntry(row, bars, "stop-slipped");
    if (!limit || !stopEntry || !slipped) {
      unrecoverable += 1;
      continue;
    }
    scorable += 1;
    if (slipped.slippageR) slippagePaid.push(slipped.slippageR);

    addTrial(overallLimit, limit);
    addTrial(overallStop, stopEntry);
    addTrial(overallSlipped, slipped);
    const bucket =
      perSymbol.get(row.symbol) ??
      { limit: emptyOutcome("limit"), stop: emptyOutcome("stop"), slipped: emptyOutcome("stop-slipped"), n: 0 };
    bucket.n += 1;
    addTrial(bucket.limit, limit);
    addTrial(bucket.stop, stopEntry);
    addTrial(bucket.slipped, slipped);
    perSymbol.set(row.symbol, bucket);

    // Hold window: how long a setup takes once it is actually filled, measured on
    // the limit entry because that is what production files today.
    if (limit.filled && limit.barsToResolve != null) {
      const key = `${row.symbol}|${row.timeframe}`;
      const entry = clock.get(key) ?? { symbol: row.symbol, timeframe: row.timeframe, bars: [] };
      entry.bars.push((limit.barsToFill ?? 1) - 1 + limit.barsToResolve);
      clock.set(key, entry);
    }

    // First-bar read, from the raw bar walk rather than a fill assumption.
    const forward = forwardBars(bars, row.created_at);
    const first = forward[0];
    if (first) {
      const long = replayDirection(row.bias) === "long";
      const risk = Math.abs(row.entry - row.stop);
      const hitStop = long ? first.low <= row.stop : first.high >= row.stop;
      const hitTarget = long ? first.high >= row.tp1 : first.low <= row.tp1;
      if (hitStop || hitTarget) {
        resolvedOnFirstBar += 1;
        const adverse = long ? row.entry - first.low : first.high - row.entry;
        if (hitTarget && !hitStop && adverse <= 0) freeWins += 1;
      }
      // How far past the planned entry price already sat when the bar opened.
      const past = long ? first.close - row.entry : row.entry - first.close;
      if (past > 0 && risk > 0) {
        entryAlreadyGone += 1;
        goneBy.push(past / risk);
      }
    }

    // Guard simulation. Staleness is judged on the last close BEFORE filing,
    // because that is the price the scanner can see at the moment it decides.
    const atFiling = priorClose(bars, row.created_at);
    const riskAtFiling = Math.abs(row.entry - row.stop);
    const long = replayDirection(row.bias) === "long";
    const staleR =
      atFiling == null || !(riskAtFiling > 0)
        ? null
        : Math.max(0, (long ? atFiling - row.entry : row.entry - atFiling) / riskAtFiling);
    for (const [tolerance, cohort] of cohorts) {
      // A row we cannot price at filing time is refused rather than assumed clean.
      if (staleR == null || staleR > tolerance) {
        cohort.refused += 1;
        continue;
      }
      cohort.survivors += 1;
      addTrial(cohort.acc, limit);
      if (limit.filled && limit.barsToResolve === 1 && limit.barsToFill === 1) cohort.firstBar += 1;
    }
  }


  const edgeOf = (a: FillOutcome, b: FillOutcome) =>
    a.netExpectancyR == null || b.netExpectancyR == null ? null : r3(b.netExpectancyR - a.netExpectancyR);

  const byInstrument: PerInstrument[] = [...perSymbol.entries()]
    .map(([symbol, b]) => {
      const l = seal(b.limit);
      const s = seal(b.stop);
      const sl = seal(b.slipped);
      return {
        symbol,
        n: b.n,
        limit: l,
        stop: s,
        stopSlipped: sl,
        netEdgeToStopEntry: edgeOf(l, s),
        netEdgeToStopEntrySlipped: edgeOf(l, sl),
      };
    })
    .sort((a, b) => b.n - a.n);

  const expiryClock: ExpiryClock[] = [...clock.values()]
    .map((c) => {
      const p90 = quantile(c.bars, 0.9);
      return {
        symbol: c.symbol,
        timeframe: c.timeframe,
        resolved: c.bars.length,
        medianBarsToResolve: median(c.bars),
        p90BarsToResolve: p90,
        maxBarsToResolve: c.bars.length ? Math.max(...c.bars) : null,
        recommendedHoldBars: c.bars.length >= minSample && p90 != null ? Math.ceil(p90) : null,
      };
    })
    .sort((a, b) => b.resolved - a.resolved);

  const ol = seal(overallLimit);
  const os = seal(overallStop);
  const osl = seal(overallSlipped);

  const firstBar: FirstBarRead = {
    resolvedOnFirstBar,
    freeWins,
    entryAlreadyGone,
    medianGoneByR: goneBy.length ? r3(median(goneBy)!) : null,
    refusedAtTolerance: TOLERANCES.map((toleranceR) => {
      const refused = goneBy.filter((g) => g > toleranceR).length;
      return { toleranceR, refused, share: scorable ? r3(refused / scorable) : 0 };
    }),
  };

  const verdicts: string[] = [];
  if (ol.netExpectancyR != null && os.netExpectancyR != null) {
    const edge = r3(os.netExpectancyR - ol.netExpectancyR);
    verdicts.push(
      edge > 0.05
        ? `Stop entries produced ${edge}R more per decided trade than limit entries (${os.decided} vs ${ol.decided} decided). The claim that every pending limit should have been a pending stop is supported at the overall level.`
        : edge < -0.05
          ? `Limit entries produced ${Math.abs(edge)}R more per decided trade than stop entries (${ol.decided} vs ${os.decided} decided). The claim that every pending limit should have been a pending stop is not supported.`
          : `Stop and limit entries land within 0.05R of each other (${os.netExpectancyR}R vs ${ol.netExpectancyR}R). At this sample the order type is not the cause of the complaint.`,
    );
  }
  if (os.unfilled > ol.unfilled) {
    verdicts.push(
      `Stop entries went unfilled more often (${os.unfilled} vs ${ol.unfilled}). Fewer trades taken is part of the trade-off and has to be counted alongside the R figure.`,
    );
  }
  if (osl.netExpectancyR != null && os.netExpectancyR != null) {
    const paid = median(slippagePaid);
    verdicts.push(
      `Priced honestly — the stop entry filled where the market actually was rather than at a level price had already left — the stop entry returns ${osl.netExpectancyR}R over ${osl.decided} decided, against ${os.netExpectancyR}R at the level and ${ol.netExpectancyR ?? "no"}R on the limit. ${osl.unfilled} signals had no trade left to take because the target was already reached.${paid == null ? "" : ` Median fill sat ${r3(paid)}R past the planned entry.`}`,
    );
  }
  if (osl.netExpectancyR != null && ol.netExpectancyR != null) {
    verdicts.push(
      osl.netExpectancyR > ol.netExpectancyR + 0.05
        ? "The order-type change survives honest fill pricing, so it is worth testing forward on one instrument."
        : "The order-type advantage does not survive honest fill pricing: most of it was buying at a price that had already gone. The real problem is the entry level being stale at filing, not the order type.",
    );
  }
  if (resolvedOnFirstBar) {
    verdicts.push(
      `${resolvedOnFirstBar} signals resolved on their first bar, ${freeWins} of them as wins with no adverse move at all. Those are the ones where the entry price was most likely already gone at filing.`,
    );
  }
  if (firstBar.medianGoneByR != null) {
    verdicts.push(
      `On ${entryAlreadyGone} signals price had already closed past the planned entry on the first bar, by a median of ${firstBar.medianGoneByR}R. Refusing to file above a tolerance would drop the signal count by the shares listed.`,
    );
  }
  const tooShort = expiryClock.filter((c) => c.recommendedHoldBars != null);
  if (tooShort.length) {
    verdicts.push(
      `Hold windows the data supports, covering 90% of resolutions: ${tooShort
        .slice(0, 6)
        .map((c) => `${c.symbol} ${c.timeframe} needs ${c.recommendedHoldBars} bars`)
        .join(", ")}.`,
    );
  }

  return {
    scanned: rows.length,
    scorable,
    unrecoverable,
    overall: {
      limit: ol,
      stop: os,
      stopSlipped: osl,
      netEdgeToStopEntry: edgeOf(ol, os),
      netEdgeToStopEntrySlipped: edgeOf(ol, osl),
      medianSlippagePaidR: slippagePaid.length ? r3(median(slippagePaid)!) : null,
    },
    byInstrument,
    expiryClock,
    firstBar,
    verdicts,
    caveats: [
      "A bar containing both the stop and the target counts as a stop in every mode. Intrabar sequence is not visible, so the pessimistic read is taken.",
      "A stop entry is allowed to be stopped on the same bar it fills, because that is what happens in a real account.",
      "The plain stop-entry column assumes a fill at the planned level even when price had already left it. That is optimistic and is why the slipped column exists; read the slipped column as the answer.",
      "Slipped fills use the last close before the trigger as the fill price, because bar opens are not stored. Real fills would land between that close and the level.",
      "Net R subtracts the static per-instrument spread and slippage estimate, not the spread quoted at the moment each signal was filed.",
      "All modes are replayed over the same stored signals, so this measures order type on setups the current engine chose. It cannot say what a different engine would have found.",
      `Instruments with fewer than ${minSample} resolutions get no recommended hold window; the sample does not support one.`,
      "Price history reaches back roughly a year per instrument. Older signals are reported as unrecoverable rather than skipped quietly.",
    ],
  };
}
