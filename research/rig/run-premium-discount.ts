// Pre-registered test: do detector setups whose entry sits on the correct side
// of the dealing range (buy in discount / sell in premium) earn more net R than
// wrong-side ones? Setups and the range read both come from src/lib/detector/.
// Run: bun research/rig/run-premium-discount.ts [fromYear]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { fetchRange, type RigBar } from "./download";
import { buildSetups, scoreSetups, medianSpread, type LedgerRow } from "./ledger";
import { register, holdoutOpened } from "./registry";
import { dayBootstrap, mean } from "./stats";
import { dealingRange, readPremiumDiscount } from "@/lib/detector/dealing-range";

const PREREG = {
  id: "premium-discount-v1",
  hypothesis: "Entries on the correct side of the 120-bar 1H dealing range (long < 50%, short > 50%) earn more net R per opportunity than wrong-side entries.",
  null: "Mean net R of correct-side minus wrong-side opportunities is zero; equal risk and target, unfilled = 0R.",
  primaryOutcome: "Difference in mean net R per opportunity, broken_level and order_block entries, day-clustered bootstrap 95% CI, build period.",
  decisionEffectR: 0.1,
  gate: "Positive difference with CI above 0 in build and positive in the untouched holdout before any move above tier B.",
};
const INSTS = ["XAU_USD", "EUR_USD", "GBP_USD", "USD_JPY", "NAS100_USD", "SPX500_USD", "US30_USD"];
const VARS = ["broken_level", "order_block"] as const;
const DIR = new URL("../data-pd/", import.meta.url).pathname;
const OUT = new URL("../out/", import.meta.url).pathname;

async function bars(inst: string, tf: string, from: number): Promise<RigBar[]> {
  const p = `${DIR}${inst}_${tf}.jsonl.gz`;
  if (existsSync(p)) return gunzipSync(readFileSync(p)).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const b = await fetchRange(inst, tf, from);
  writeFileSync(p, gzipSync(b.map((x) => JSON.stringify(x)).join("\n")));
  return b;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

async function main() {
  const fromYear = Number(process.argv[2] ?? 2022);
  if (holdoutOpened(PREREG.id)) throw new Error("Holdout already opened for this pre-registration.");
  register("prereg", PREREG);
  mkdirSync(DIR, { recursive: true }); mkdirSync(OUT, { recursive: true });
  const from = Date.UTC(fromYear, 0, 1) / 1000;
  const holdoutFrom = from + 0.7 * (Date.now() / 1000 - from);
  const runId = `${PREREG.id}-${Date.now()}`;
  type Row = LedgerRow & { side: "correct" | "wrong"; ote: boolean; pos: number };
  const rows: Row[] = [];
  for (const inst of INSTS) {
    const h1 = await bars(inst, "H1", from), m15 = await bars(inst, "M15", from);
    const spread = medianSpread(m15);
    const { setups } = buildSetups(inst, h1);
    const scored = scoreSetups(inst, setups, m15, { buffer: spread * 0.25, stopSlip: spread * 0.5, costMult: 1 });
    const idx = new Map(h1.map((b, i) => [b.t, i]));
    for (const r of scored) {
      if (!VARS.includes(r.variant as (typeof VARS)[number]) || r.level == null) continue;
      const i = idx.get(r.setupTime - 3600); if (i == null) continue;
      const range = dealingRange(h1.slice(Math.max(0, i - 119), i + 1).map((b) => ({ high: b.h, low: b.l })));
      if (!range) continue;
      const pd = readPremiumDiscount(r.long ? "Long" : "Short", r.level, range);
      rows.push({ ...r, side: pd.correctSide ? "correct" : "wrong", ote: pd.ote, pos: round(pd.position) });
    }
    console.log(inst, "h1", h1.length, "m15", m15.length, "setups", setups.length);
  }
  writeFileSync(`${OUT}${runId}.json`, JSON.stringify(rows));
  const sum = (x: Row[]) => ({ n: x.length, fillRate: round(x.filter((r) => r.filled).length / Math.max(1, x.length)), winRate: round(x.filter((r) => r.r > 0).length / Math.max(1, x.filter((r) => r.filled).length)), avgR: round(mean(x.map((r) => r.r))), totalR: round(x.reduce((s, r) => s + r.r, 0)) });
  const report: Record<string, unknown> = {};
  for (const split of ["build", "holdout"] as const) {
    const s = rows.filter((r) => (split === "build" ? r.setupTime < holdoutFrom : r.setupTime >= holdoutFrom));
    const cells: Record<string, unknown> = {};
    for (const v of VARS) for (const side of ["correct", "wrong"] as const) {
      const x = s.filter((r) => r.variant === v && r.side === side);
      cells[`${v}:${side}`] = sum(x);
      register("trial", { runId, prereg: PREREG.id, variant: `${v}:${side}`, split, ...sum(x) });
    }
    cells["ote_correct"] = sum(s.filter((r) => r.side === "correct" && r.ote));
    cells["correct_not_ote"] = sum(s.filter((r) => r.side === "correct" && !r.ote));
    const byInst: Record<string, unknown> = {};
    for (const inst of INSTS) { const x = s.filter((r) => r.inst === inst); byInst[inst] = { correct: sum(x.filter((r) => r.side === "correct")).avgR, wrong: sum(x.filter((r) => r.side === "wrong")).avgR }; }
    cells.byInstrumentAvgR = byInst;
    // Difference CI: day-clustered bootstrap on (correct mean - wrong mean) per row,
    // centered so wrong-side rows contribute negatively.
    const c = s.filter((r) => r.side === "correct"), w = s.filter((r) => r.side === "wrong");
    const mc = mean(c.map((r) => r.r)), mw = mean(w.map((r) => r.r));
    const diffRows = [...c.map((r) => ({ day: r.day, time: r.setupTime, v: (r.r - mc) + (mc - mw) })), ...w.map((r) => ({ day: r.day, time: r.setupTime, v: (r.r - mw) * -1 + (mc - mw) }))];
    cells.diff = { avgR: round(mc - mw), ci: dayBootstrap(diffRows) };
    report[split] = cells;
  }
  register("verdict", { runId, prereg: PREREG.id, report });
  console.log(JSON.stringify(report, null, 1));
}
await main();
