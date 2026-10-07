// Day 7: first pre-registered test. Break-close market entry vs a retest at the
// broken level, equal risk, intent to trade. Run: bun research/rig/run-break-vs-retest.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { loadBars, RIG_INSTRUMENTS, fetchRange } from "./download";
import { buildSetups, scoreSetups, medianSpread, toCsv, VARIANTS, type LedgerRow } from "./ledger";
import type { QuoteBar } from "./fills";
import { register, comparisonCount, holdoutOpened } from "./registry";
import { dayBootstrap, walkForward, pbo, deflatedSharpe, minDetectable, mean, sd } from "./stats";

const PREREG = {
  id: "break-vs-retest-v1",
  hypothesis: "A limit entry at the broken level after a confirmed sweep-and-break earns more net R per opportunity than a market entry at the break close.",
  null: "Mean paired difference (broken_level minus break_close) is zero, equal risk and target, unfilled = 0R.",
  primaryOutcome: "Mean paired net R difference per opportunity, day-clustered bootstrap 95% CI, build period.",
  decisionEffectR: 0.1,
  gate: "PBO <= 0.05 across the 5 entry variants; positive paired delta in the untouched holdout; still positive at 1.5x costs.",
};
const HOLDOUT_FROM = Math.floor(Date.UTC(2015, 0, 1) / 1000 + 0.7 * (Date.now() / 1000 - Date.UTC(2015, 0, 1) / 1000));
const OUT = new URL("../out/", import.meta.url).pathname;

async function main() {
  if (holdoutOpened(PREREG.id)) throw new Error("Holdout for this pre-registration was already opened. Register a new hypothesis.");
  register("prereg", PREREG);
  mkdirSync(OUT, { recursive: true });
  const runId = `${PREREG.id}-${Date.now()}`;

  const all: LedgerRow[] = [], all15: LedgerRow[] = [];
  const m1Cache = new Map<number, QuoteBar[]>();
  let m1Calls = 0;
  const ambiguous = { pessimistic: 0, m1: 0 };
  for (const inst of RIG_INSTRUMENTS) {
    const h1 = loadBars(inst, "H1"), m15 = loadBars(inst, "M15");
    if (!h1.length || !m15.length) { console.log("missing data", inst); continue; }
    const spread = medianSpread(m15);
    const cfg = { buffer: spread * 0.25, stopSlip: spread * 0.5, costMult: 1 };
    const { setups } = buildSetups(inst, h1);
    let rows = scoreSetups(inst, setups, m15, cfg);
    // Resolve same-bar stop+target at M1 (capped); the rest stay pessimistic.
    const need = [...new Set(rows.filter((r) => r.ambiguous === "pessimistic" && r.ambiguousBar).map((r) => r.ambiguousBar))].filter((t): t is number => t != null);
    for (const t of need) {
      if (m1Calls >= 1500 || m1Cache.has(t)) continue;
      m1Calls++;
      try { m1Cache.set(t, (await fetchRange(inst, "M1", t, t + 899)).map((b) => ({ t: b.t, bh: b.bh, bl: b.bl, ah: b.ah, al: b.al, bc: b.bc, ac: b.ac, ao: b.ao, bo: b.bo }))); } catch { /* stays pessimistic */ }
    }
    const m1 = (t: number) => m1Cache.get(t) ?? null;
    rows = scoreSetups(inst, setups, m15, cfg, { m1 });
    const rows15 = scoreSetups(inst, setups, m15, { ...cfg, costMult: 1.5 }, { m1 });
    for (const r of rows) { if (r.ambiguous === "pessimistic") ambiguous.pessimistic++; if (r.ambiguous === "m1-resolved") ambiguous.m1++; }
    all.push(...rows); all15.push(...rows15);
    console.log(inst, "setups", setups.length, "spread", spread);
  }
  writeFileSync(`${OUT}${runId}-ledger.csv`, toCsv(all));

  const paired = (rows: LedgerRow[], a: string, b: string) => {
    const m = new Map<string, { a?: number; b?: number; day: string; time: number }>();
    for (const r of rows) {
      const k = `${r.inst}:${r.setupTime}:${r.long}`;
      const e = m.get(k) ?? { day: r.day, time: r.setupTime };
      if (r.variant === a) e.a = r.r; if (r.variant === b) e.b = r.r;
      m.set(k, e);
    }
    return [...m.values()].filter((e) => e.a != null && e.b != null).map((e) => ({ day: e.day, time: e.time, v: e.a! - e.b!, a: e.a!, b: e.b! }));
  };
  const build = all.filter((r) => r.setupTime < HOLDOUT_FROM);
  const summary = (rows: LedgerRow[]) => Object.fromEntries(VARIANTS.map((v) => {
    const x = rows.filter((r) => r.variant === v);
    return [v, { n: x.length, fillRate: round(x.filter((r) => r.filled).length / Math.max(1, x.length)), avgR: round(mean(x.map((r) => r.r))), totalR: round(x.reduce((s, r) => s + r.r, 0)) }];
  }));
  const buildSummary = summary(build);
  for (const [v, s] of Object.entries(buildSummary)) register("trial", { runId, prereg: PREREG.id, variant: v, split: "build", ...s });

  // 1. Power check first.
  const pb = paired(build, "broken_level", "break_close");
  const mde = minDetectable(pb.map((p) => p.v));
  // 2. Primary outcome.
  const boot = dayBootstrap(pb);
  const folds = walkForward(pb, 5, 3 * 86400).map((f) => ({ n: f.test.length, avgDelta: round(mean(f.test.map((p) => p.v))) }));
  // 3. PBO over all variants, monthly returns.
  const months = new Map<string, number[][]>();
  for (const r of build) { const k = r.day.slice(0, 7); const arr = months.get(k) ?? VARIANTS.map(() => []); arr[VARIANTS.indexOf(r.variant)]!.push(r.r); months.set(k, arr); }
  const matrix = [...months.entries()].sort().map(([, a]) => a.map((x) => mean(x)));
  const overfit = pbo(matrix, 10);
  const trials = Math.max(comparisonCount(), VARIANTS.length);
  const srs = VARIANTS.map((_, j) => { const c = matrix.map((r) => r[j]!); return sd(c) ? mean(c) / sd(c) : 0; });
  const dsr = deflatedSharpe(matrix.map((r) => r[VARIANTS.indexOf("broken_level")]!), trials, sd(srs) ** 2);
  // 4. 1.5x costs.
  const p15 = paired(all15.filter((r) => r.setupTime < HOLDOUT_FROM), "broken_level", "break_close");
  const cost15 = { avgDelta: round(mean(p15.map((p) => p.v))), retestAvgR: round(mean(p15.map((p) => p.a))) };
  register("trial", { runId, prereg: PREREG.id, variant: "broken_level-vs-break_close", split: "cost1.5", n: p15.length, avgR: cost15.avgDelta, totalR: round(p15.reduce((s, p) => s + p.v, 0)) });
  // 5. Holdout, touched once.
  const ph = paired(all.filter((r) => r.setupTime >= HOLDOUT_FROM), "broken_level", "break_close");
  const holdout = { n: ph.length, avgDelta: round(mean(ph.map((p) => p.v))), totalDelta: round(ph.reduce((s, p) => s + p.v, 0)), retestAvgR: round(mean(ph.map((p) => p.a))), breakAvgR: round(mean(ph.map((p) => p.b))), boot: dayBootstrap(ph) };
  register("trial", { runId, prereg: PREREG.id, variant: "broken_level-vs-break_close", split: "holdout", n: ph.length, avgR: holdout.avgDelta, totalR: holdout.totalDelta });

  const gate = { pboOk: overfit.pbo <= 0.05, holdoutOk: holdout.avgDelta > 0 && holdout.boot.lo > 0, costOk: cost15.avgDelta > 0 };
  const verdict = mde > PREREG.decisionEffectR ? "UNDERPOWERED" : boot.lo > 0 && gate.pboOk && gate.holdoutOk && gate.costOk ? "ADOPT" : "REJECT";
  const decidedBy = verdict === "UNDERPOWERED" ? `MDE ${round(mde)}R > ${PREREG.decisionEffectR}R` : `build delta ${round(boot.mean)}R (95% CI ${round(boot.lo)} to ${round(boot.hi)}), holdout delta ${holdout.avgDelta}R, PBO ${round(overfit.pbo)}, 1.5x cost delta ${cost15.avgDelta}R`;
  const report = { runId, prereg: PREREG, holdoutFrom: new Date(HOLDOUT_FROM * 1000).toISOString(), comparisons: trials, power: { n: pb.length, mdeR: round(mde) }, primary: { ...boot, mean: round(boot.mean), lo: round(boot.lo), hi: round(boot.hi) }, folds, buildSummary, pbo: overfit, deflatedSharpe: dsr, cost15, holdout, ambiguous, m1Calls, gate, verdict, decidedBy, dataLimits: ["Volume is tick count", "Candles not ticks; same-bar stop+target resolved at M1 or counted as stop", "Index prices are OANDA CFDs"] };
  register("verdict", { runId, prereg: PREREG.id, verdict, decidedBy });
  writeFileSync(`${OUT}${runId}-report.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
}
const round = (n: number) => Math.round(n * 1000) / 1000;
if (import.meta.main) await main();
