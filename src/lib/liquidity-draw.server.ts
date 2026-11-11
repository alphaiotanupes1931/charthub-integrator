import type { MarketSnapshot, ResearchMemo, TradePlan } from "./agents/types";
import type { TradeStyle } from "./tradeTiming";
import { computeOrderBlocks } from "./orderBlocks";
import { zoneStatus, clearStopFromZones, drawLateCaps, drawGrade, drawLevels, latestDrawZone, replayDraw, LIQUIDITY_DRAW_VERSION, type DrawRead, type DrawState } from "./detector/liquidity-draw";
import type { PoolSeries } from "./detector/liquidity-pools";

function seriesFor(snap: MarketSnapshot): PoolSeries {
  return { "15m": snap.candles15m ?? [], "1H": snap.candles1h ?? [], "4H": snap.candles4h ?? [], Daily: snap.candlesDaily ?? [] };
}

/** Server-owned market state; never accepts a draw or feed supplied by a visitor. */
export async function persistentDraw(snap: MarketSnapshot): Promise<DrawRead> {
  const feed = snap.liquidityFeed;
  if (!feed) throw new Error("One-feed draw data unavailable");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const series = seriesFor(snap);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await supabaseAdmin.from("liquidity_draw_state").select("state, version, processed_time")
      .eq("symbol", snap.ticker).eq("feed", feed).maybeSingle();
    if (error) throw new Error("Could not read active draw");
    const prior = data?.state as unknown as DrawState | null;
    const first = snap.candles15m?.[0];
    if (prior?.processedTime && first && first.time > prior.processedTime + 900) {
      throw new Error("Draw continuity unverified after missing candle history. No order issued.");
    }
    if (prior?.processedTime && prior.processedTime > (snap.candles15m?.at(-1)?.time ?? 0)) {
      throw new Error("This snapshot is older than the saved draw. Rescan.");
    }
    const read = replayDraw(series, feed, prior);
    if (data && Number(data.processed_time) >= read.state.processedTime) return read;
    const { data: saved, error: saveError } = await supabaseAdmin.rpc("save_liquidity_draw", {
      p_symbol: snap.ticker, p_feed: feed, p_version: data?.version ?? 0,
      p_time: read.state.processedTime, p_state: read.state as never,
    });
    if (saveError) throw new Error("Could not save active draw");
    if (saved) return read;
  }
  throw new Error("Draw changed during scan; rescan to use the latest lock");
}

function nestedAtSweep(snap: MarketSnapshot, state: DrawState): boolean {
  if (!state.sweep || !state.side) return false;
  const long = state.side === "buyside", t = state.sweep.time;
  // F10: a 4H/Daily zone already closed through before the sweep is broken and cannot nest.
  const h4Bars = (snap.candles4h ?? []).filter(b => b.time + 14400 <= t), dBars = (snap.candlesDaily ?? []).filter(b => b.time + 86400 <= t);
  const intact = (bars: typeof h4Bars, step: number) => (z: { kind: string; top: number; bot: number; time: number }) =>
    zoneStatus({ top: z.top, bottom: z.bot }, z.kind === "bullish", bars, z.time + step).status !== "broken";
  const h4 = computeOrderBlocks(h4Bars, { max: 30 }).filter(intact(h4Bars, 14400 * 2));
  const daily = computeOrderBlocks(dBars, { max: 30 }).filter(intact(dBars, 86400 * 2));
  return h4.some(a => a.kind === (long ? "bullish" : "bearish") && state.sweep &&
    state.sweep.extreme >= a.bot && state.sweep.extreme <= a.top && daily.some(b =>
      b.kind === a.kind && a.bot >= b.bot && a.top <= b.top));
}

export async function liquidityDrawPlan(snap: MarketSnapshot, memo: ResearchMemo, tradeStyle: TradeStyle): Promise<TradePlan> {
  const base: TradePlan = {
    methodologyVersion: LIQUIDITY_DRAW_VERSION, entryModel: "liquidity_draw_proximal",
    grade: "NO ENTRY", bias: "Neutral", confidence: 0,
    notes: "Awaiting a confirmed liquidity sweep and a fresh entry zone.",
    entry: "-", stop: "-", tp1: "-", tp2: "-", rr: "-", details: "", memo,
    dataSource: snap.source, dataFetchedAt: snap.fetchedAt, candleCount: snap.candles.length,
    refPrice: snap.lastPrice, tradeStyle,
    dailyBias: snap.mtf?.ladder?.find(r => r.label === "Daily")?.bias ?? snap.cisd.htfBias,
    currentTrend: snap.mtf?.h4.trend,
    orderFlow: snap.orderFlow,
  };
  if (!snap.liquidityFeed) return { ...base, notes: "OANDA draw data is incomplete. No mixed-feed setup was issued; rescan when all four timeframes are available." };
  let read: DrawRead;
  try { read = await persistentDraw(snap); }
  catch (e) { return { ...base, notes: e instanceof Error ? e.message : "Active draw could not be verified. Rescan." }; }
  const { state } = read;
  const nowSec = (snap.candles15m?.at(-1)?.time ?? 0) + 900;
  const sweepAgeHours = state.sweep ? Math.round(((nowSec - state.sweep.time) / 3600) * 10) / 10 : undefined;
  base.liquidityDraw = {
    status: state.status, side: state.side, feed: state.feed,
    lastSweep: state.sweep && !state.reset?.confirmedAt ? { price: state.sweep.extreme, time: state.sweep.time } : null,
    pools: read.targets.slice(0, 3).map(p => ({ price: p.price, frame: p.frame })),
    sizeMultiplier: 0, continuation: false, sweepAgeHours, cancelled: state.cancelled ?? null,
  };
  if (state.status === "cancelled" && state.cancelled) {
    const c = state.cancelled, dir = c.previousSide === "buyside" ? "sellside" : "buyside";
    const px = snap.lastPrice;
    const next = read.pools.filter(p => p.status === "unswept" && p.side === dir && (dir === "sellside" ? p.price < px : p.price > px))
      .sort((a, b) => Math.abs(a.price - px) - Math.abs(b.price - px))[0];
    const d = px >= 100 ? 2 : px >= 10 ? 3 : 5;
    return { ...base, notes: `Draw cancelled: 1H CHoCH. The 1H candle at ${new Date(c.time * 1000).toISOString()} closed beyond the 1H swing ${c.level.toFixed(d)} against the ${c.previousSide} draw. No ${c.previousSide === "buyside" ? "long" : "short"} continuation.${next ? ` Candidate draw: ${dir} pool ${next.price.toFixed(d)}; awaiting a fresh zone.` : ""}` };
  }
  // A target touch alone never authorizes an opposite order; wait for reclaim + closed CHoCH.
  if (!state.side || !state.sweep || state.status !== "active") {
    base.notes = state.status === "reached" ? "Draw reached. Awaiting a closed 15m reversal confirmation or the next unswept pool."
      : state.status === "invalidated" ? "Previous draw invalidated. Awaiting a closed opposing structural break and an unswept pool; a wick or Daily bias alone cannot reset direction." : base.notes;
    return base;
  }
  const zone = latestDrawZone(seriesFor(snap), state, snap.lastPrice);
  if (!zone) return { ...base, notes: `Draw remains ${state.side}. Awaiting a fresh 15m/1H zone; Daily bias cannot flip this lock.` };
  const rawLevels = drawLevels(state, zone, read.targets, snap.stats.atr14);
  if (!rawLevels) return { ...base, notes: `Draw remains ${state.side}, but no valid protected entry and forward target are mapped.` };
  const bias = state.side === "buyside" ? "Long" : "Short", want = bias === "Long" ? "bullish" : "bearish";
  // F6: the stop may not sit inside any 15m/1H/4H zone.
  const allZones = [snap.candles15m, snap.candles1h, snap.candles4h].flatMap(b => computeOrderBlocks(b ?? [], { max: 30 }))
    .map(z => ({ top: z.top, bottom: z.bot }));
  const levels = { ...rawLevels, stop: clearStopFromZones(bias === "Long", rawLevels.stop, allZones, snap.stats.atr14) };
  const aligned = base.dailyBias === want && snap.mtf?.h4.direction === want;
  const continuation = zone.continuation || Boolean(state.reset?.confirmedAt);
  const policy0 = drawGrade({ aligned, nested: !state.reset?.confirmedAt && nestedAtSweep(snap, state), continuation, opposingInsideStop: false });
  const decimals0 = snap.lastPrice >= 100 ? 2 : snap.lastPrice >= 10 ? 3 : 5;
  const lateCaps = drawLateCaps({ long: bias === "Long", entry: levels.entry, stop: levels.stop, tp1: levels.tp1, sweepPrice: state.sweep.extreme,
    drawPrice: state.target?.price ?? null, continuation: zone.continuation, pools: read.pools, fmt: n => n.toFixed(decimals0) });
  // F10: a zone that already held one visit is downgraded to B at most.
  if (zone.status === "touched" && policy0.cap === "A") lateCaps.push({ label: "Touched zone", cap: "B",
    reason: `The ${zone.frame} ${zone.kind} was already visited once; second touches break more often.` });
  const policy = lateCaps.some(c => c.cap === "C") ? { cap: "C" as const, sizeMultiplier: 0.25 }
    : lateCaps.length ? { cap: "B" as const, sizeMultiplier: Math.min(policy0.sizeMultiplier, 0.5) } : policy0;
  let grade: TradePlan["grade"] = policy.cap;
  const warnings: string[] = [];
  const caps: NonNullable<TradePlan["gradeCaps"]> = [{ label: "Liquidity draw policy", cap: policy0.cap,
    reason: aligned ? "Draw agrees with Daily and 4H; maximum A, full configured risk."
      : policy.cap === "A" ? "Counter-bias sweep inside nested 4H/Daily zone; maximum A, half risk."
      : "Counter-bias or continuation draw; maximum B, half risk." }, ...lateCaps];
  // Preserve the existing measured history adjustment; it cannot exceed draw ceilings.
  try {
    const tr = await import("./scan-track-record.shared");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("scan_log").select("status, realized_r")
      .eq("symbol", snap.ticker).eq("timeframe", snap.interval).eq("bias", bias)
      .gte("created_at", new Date(Date.now() - tr.TRACK_RECORD_LOOKBACK_DAYS * 86400000).toISOString()).limit(1000);
    const rec = tr.evaluateTrackRecord((data ?? []).map(r => ({ status: r.status, realized_r: r.realized_r == null ? null : Number(r.realized_r) })), grade, { otherCapBinding: true, label: `${snap.ticker} ${snap.interval} ${bias}` });
    if (rec.text) warnings.push(rec.text);
    if (rec.action === "down") { grade = rec.newGrade as TradePlan["grade"]; caps.push({ label: "Scan track record", cap: grade, reason: rec.text }); }
  } catch { /* non-blocking track record */ }
  try {
    const { fetchCalendar, highImpactAhead, currenciesFor } = await import("./news.server");
    const currencies = currenciesFor(snap.ticker);
    if (highImpactAhead(await fetchCalendar(), 4).some(e => currencies.includes(e.country.toUpperCase()) && /^high$/i.test(e.impact.trim()))) {
      if (grade === "A") grade = "B";
      warnings.push("High-impact news within the hold window: wait or reduce risk.");
      caps.push({ label: "High-impact news", cap: "B", reason: warnings.at(-1) ?? "News risk" });
    }
  } catch { /* calendar advisory */ }
  let chartPattern: TradePlan["chartPattern"];
  const cp = await import("./detector/chart-patterns");
  for (const [frame, bars] of [["1H", snap.candles1h], ["4H", snap.candles4h], ["15m", snap.candles15m]] as const) {
    if (!bars?.length) continue;
    const p = cp.detectChartPattern(bars);
    if (p) { chartPattern = { name: `${p.name} (${frame})`, direction: p.direction, status: p.status, trigger: p.trigger, invalidation: p.invalidation, points: p.points ?? [] }; break; }
  }
  const decimals = snap.lastPrice >= 100 ? 2 : snap.lastPrice >= 10 ? 3 : 5;
  const fmt = (n: number) => n.toFixed(decimals);
  const tolerance = Math.max(snap.stats.atr14 * 0.1, snap.lastPrice * 0.0001);
  const atZone = snap.lastPrice >= zone.bottom - tolerance && snap.lastPrice <= zone.top + tolerance;
  const latest = snap.candles15m?.at(-1);
  const reaction = latest && latest.time >= zone.formedAt && latest.low <= zone.top && latest.high >= zone.bottom &&
    (bias === "Long" ? latest.close > latest.open && latest.close >= zone.top : latest.close < latest.open && latest.close <= zone.bottom);
  const triggered = Boolean(atZone && reaction);
  const note = `${bias === "Long" ? "BUY" : "SELL"} ${state.reset?.confirmedAt ? `structural-break reset (closed beyond ${fmt(state.reset.level)})` : zone.continuation ? "continuation" : "sweep setup"} toward ${state.side}. ${zone.frame} ${zone.kind} proximal entry ${fmt(levels.entry)}. Daily/4H affect risk, not direction.`;
  const finalPool = levels.finalPool;
  const opposingZones = computeOrderBlocks(snap.candles4h ?? [], { max: 30 }).filter(b => b.kind !== want &&
    zoneStatus({ top: b.top, bottom: b.bot }, b.kind === "bullish", snap.candles4h ?? [], b.time + 28800).status !== "broken");
  const runnerText = `Runner: TP2 ${fmt(levels.tp2)} is not a hard exit. After TP2, trail behind 1H swings and close on a 1H CHoCH against the draw or at the final pool ${fmt(levels.finalPool)}.`;
  const htfFinal = opposingZones.map(b => bias === "Long" ? b.bot : b.top)
    .filter(p => bias === "Long" ? p >= finalPool : p <= finalPool).sort((a, b) => Math.abs(a - finalPool) - Math.abs(b - finalPool))[0] ?? finalPool;
  return { ...base, grade, bias, confidence: grade === "A" ? 75 : grade === "B" ? 60 : 40,
    notes: `${note} ${warnings.join(" ")}`, synopsis: note,
    entry: fmt(levels.entry), stop: fmt(levels.stop), tp1: fmt(levels.tp1), tp2: fmt(levels.tp2),
    rr: `1 : ${(Math.abs(levels.tp2 - levels.entry) / Math.abs(levels.entry - levels.stop)).toFixed(1)}`,
    details: `${note}\n${state.reset?.confirmedAt ? `Structural reset confirmed at ${new Date(state.reset.confirmedAt * 1000).toISOString()}; no new sweep claimed.` : `Sweep ${fmt(state.sweep.extreme)} at ${new Date(state.sweep.time * 1000).toISOString()} (${sweepAgeHours}h ago).`}${levels.stop !== rawLevels.stop ? ` Stop moved from ${fmt(rawLevels.stop)} to clear a zone.` : ""} Feed ${state.feed}. Next pools ${read.targets.slice(0, 3).map(p => fmt(p.price)).join(", ")}. Final HTF target ${fmt(htfFinal)}. Risk multiplier ${policy.sizeMultiplier}. Stop beyond ${continuation ? "zone far edge" : "sweep extreme"}. Zone ${zone.status ?? "fresh"}. ${runnerText} ${warnings.join(" ")}`,
    counterTrend: !aligned, chartPattern, warnings, gradeCaps: caps.map(c => ({ ...c, binding: c.cap === grade })),
    triggered, triggerLevel: triggered ? undefined : levels.entry,
    triggerRule: triggered ? "Price is at the fresh zone with a closed 15m reaction." : "Wait for price at the fresh zone and a closed 15m reaction; do not chase.",
    liquidityDraw: { ...base.liquidityDraw, sizeMultiplier: policy.sizeMultiplier, continuation, finalTarget: htfFinal, finalPool: levels.finalPool },
    entryZone: { label: `${zone.frame} ${zone.kind}`, top: zone.top, bottom: zone.bottom,
      quality: 0, qualityLabel: "medium", distanceAtr: Math.abs(levels.entry - snap.lastPrice) / Math.max(snap.stats.atr14, 1e-9) },
  };
}