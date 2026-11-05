import type { MarketSnapshot, ResearchMemo, TradePlan } from "./agents/types";
import type { TradeStyle } from "./tradeTiming";
import { computeOrderBlocks } from "./orderBlocks";
import { drawGrade, drawLevels, latestDrawZone, replayDraw, LIQUIDITY_DRAW_VERSION, type DrawRead, type DrawState } from "./detector/liquidity-draw";
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
  const h4 = computeOrderBlocks((snap.candles4h ?? []).filter(b => b.time + 14400 <= t), { max: 30 });
  const daily = computeOrderBlocks((snap.candlesDaily ?? []).filter(b => b.time + 86400 <= t), { max: 30 });
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
  };
  if (!snap.liquidityFeed) return { ...base, notes: "OANDA draw data is incomplete. No mixed-feed setup was issued; rescan when all four timeframes are available." };
  let read: DrawRead;
  try { read = await persistentDraw(snap); }
  catch (e) { return { ...base, notes: e instanceof Error ? e.message : "Active draw could not be verified. Rescan." }; }
  const { state } = read;
  base.liquidityDraw = {
    status: state.status, side: state.side, feed: state.feed,
    lastSweep: state.sweep ? { price: state.sweep.extreme, time: state.sweep.time } : null,
    pools: read.targets.slice(0, 3).map(p => ({ price: p.price, frame: p.frame })),
    sizeMultiplier: 0, continuation: false,
  };
  // A target touch alone never authorizes an opposite order; wait for reclaim + closed CHoCH.
  if (!state.side || !state.sweep || state.status !== "active") {
    base.notes = state.status === "reached" ? "Draw reached. Awaiting a closed 15m reversal confirmation or the next unswept pool." : base.notes;
    return base;
  }
  const zone = latestDrawZone(seriesFor(snap), state, snap.lastPrice);
  if (!zone) return { ...base, notes: `Draw remains ${state.side}. Awaiting a fresh 15m/1H zone; Daily bias cannot flip this lock.` };
  const levels = drawLevels(state, zone, read.targets, snap.stats.atr14);
  if (!levels) return { ...base, notes: `Draw remains ${state.side}, but no valid protected entry and forward target are mapped.` };
  const bias = state.side === "buyside" ? "Long" : "Short", want = bias === "Long" ? "bullish" : "bearish";
  const aligned = base.dailyBias === want && snap.mtf?.h4.direction === want;
  const opposingInsideStop = read.pools.some(p => p.status === "unswept" && p.side !== state.side &&
    (bias === "Long" ? p.price > levels.stop && p.price < levels.entry : p.price < levels.stop && p.price > levels.entry));
  const policy = drawGrade({ aligned, nested: nestedAtSweep(snap, state), continuation: zone.continuation, opposingInsideStop });
  let grade: TradePlan["grade"] = policy.cap;
  const warnings: string[] = [];
  const caps: NonNullable<TradePlan["gradeCaps"]> = [{ label: "Liquidity draw policy", cap: policy.cap,
    reason: opposingInsideStop ? "Unswept opposing liquidity lies inside the stop; reduced risk."
      : aligned ? "Draw agrees with Daily and 4H; maximum A, full configured risk."
      : policy.cap === "A" ? "Counter-bias sweep inside nested 4H/Daily zone; maximum A, half risk."
      : "Counter-bias or continuation draw; maximum B, half risk." }];
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
  const note = `${bias === "Long" ? "BUY" : "SELL"} ${zone.continuation ? "continuation" : "sweep setup"} toward ${state.side}. ${zone.frame} ${zone.kind} proximal entry ${fmt(levels.entry)}. Daily/4H affect risk, not direction.`;
  const finalPool = levels.finalPool;
  const opposingZones = computeOrderBlocks(snap.candles4h ?? [], { max: 30 }).filter(b => b.kind !== want);
  const htfFinal = opposingZones.map(b => bias === "Long" ? b.bot : b.top)
    .filter(p => bias === "Long" ? p >= finalPool : p <= finalPool).sort((a, b) => Math.abs(a - finalPool) - Math.abs(b - finalPool))[0] ?? finalPool;
  return { ...base, grade, bias, confidence: grade === "A" ? 75 : grade === "B" ? 60 : 40,
    notes: `${note} ${warnings.join(" ")}`, synopsis: note,
    entry: fmt(levels.entry), stop: fmt(levels.stop), tp1: fmt(levels.tp1), tp2: fmt(levels.tp2),
    rr: `1 : ${(Math.abs(levels.tp2 - levels.entry) / Math.abs(levels.entry - levels.stop)).toFixed(1)}`,
    details: `${note}\nSweep ${fmt(state.sweep.extreme)} at ${new Date(state.sweep.time * 1000).toISOString()}. Feed ${state.feed}. Next pools ${read.targets.slice(0, 3).map(p => fmt(p.price)).join(", ")}. Final HTF target ${fmt(htfFinal)}. Risk multiplier ${policy.sizeMultiplier}. Stop beyond ${zone.continuation ? "zone far edge" : "sweep extreme"}. ${warnings.join(" ")}`,
    counterTrend: !aligned, chartPattern, warnings, gradeCaps: caps.map(c => ({ ...c, binding: c.cap === grade })),
    triggered, triggerLevel: triggered ? undefined : levels.entry,
    triggerRule: triggered ? "Price is at the fresh zone with a closed 15m reaction." : "Wait for price at the fresh zone and a closed 15m reaction; do not chase.",
    liquidityDraw: { ...base.liquidityDraw, sizeMultiplier: policy.sizeMultiplier, continuation: zone.continuation, finalTarget: htfFinal },
    entryZone: { label: `${zone.frame} ${zone.kind}`, top: zone.top, bottom: zone.bottom,
      quality: 0, qualityLabel: "medium", distanceAtr: Math.abs(levels.entry - snap.lastPrice) / Math.max(snap.stats.atr14, 1e-9) },
  };
}