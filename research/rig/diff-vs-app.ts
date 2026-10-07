// Validation: run the rig over the app's signal-history window and diff its
// setups against what the app actually filed. Every divergence gets a label.
// Run: bun research/rig/diff-vs-app.ts /path/to/app-signals.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadBars } from "./download";
import { buildSetups } from "./ledger";

const MAP: Record<string, string> = { "XAU/USD": "XAU_USD", "XAG/USD": "XAG_USD", "EUR/USD": "EUR_USD", "GBP/USD": "GBP_USD", "USD/JPY": "USD_JPY", NAS100: "NAS100_USD", SPX500: "SPX500_USD", US30: "US30_USD", "BTC/USD": "BTC_USD" };
type App = { symbol: string; bias: "Long" | "Short"; t: number; entry: string; stop: string; status: string; net_r: string | null };

const app = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as App[];
const from = Math.min(...app.map((a) => a.t)) - 14 * 86400;
const out: Record<string, unknown> = {};
const rows: Array<Record<string, unknown>> = [];
const W = 6 * 3600;
for (const [sym, inst] of Object.entries(MAP)) {
  const h1 = loadBars(inst, "H1"), m15 = loadBars(inst, "M15");
  const win = h1.filter((b) => b.t >= from - 200 * 3600);
  const { setups } = buildSetups(inst, win);
  const sigs = app.filter((a) => a.symbol === sym);
  const used = new Set<number>();
  const counts: Record<string, number> = {};
  for (const s of sigs) {
    const long = s.bias === "Long";
    const near = setups.filter((x) => x.setupTime <= s.t && x.setupTime > s.t - W);
    const same = near.filter((x) => x.long === long).pop();
    const opp = near.find((x) => x.long !== long);
    const bar = m15.filter((b) => b.t <= s.t).pop();
    const entry = Number(s.entry), stop = Number(s.stop), risk = Math.abs(entry - stop);
    // Production defect check: a long limit above the ask (or short below the bid) was already passed.
    const passed = bar ? (long ? entry > bar.ac : entry < bar.bc) : null;
    const distFromPriceR = bar && risk ? Math.round(((long ? bar.ac - entry : entry - bar.bc) / risk) * 100) / 100 : null;
    let label: string;
    if (same) { used.add(same.setupTime); label = "matched"; }
    else if (opp) label = "rig-opposite-direction";
    else label = "app-only-no-sweep-break";
    const bl = same?.levels.broken_level;
    const entryVsBrokenR = same && bl != null ? Math.round(((entry - bl) / same.risk) * 100) / 100 : null;
    counts[label] = (counts[label] ?? 0) + 1;
    if (passed) counts["entry-already-passed"] = (counts["entry-already-passed"] ?? 0) + 1;
    rows.push({ symbol: sym, t: s.t, bias: s.bias, status: s.status, net_r: s.net_r, label, entryAlreadyPassed: passed, distFromPriceR, entryVsBrokenR });
  }
  const appFrom = Math.min(...sigs.map((s) => s.t), Infinity);
  const rigInWindow = setups.filter((x) => x.setupTime >= appFrom);
  counts["rig-only-not-filed"] = rigInWindow.filter((x) => !used.has(x.setupTime)).length;
  counts["rig-setups-in-window"] = rigInWindow.length;
  counts["app-signals"] = sigs.length;
  out[sym] = counts;
  console.log(sym, JSON.stringify(counts));
}
const total: Record<string, number> = {};
for (const c of Object.values(out) as Record<string, number>[]) for (const [k, v] of Object.entries(c)) total[k] = (total[k] ?? 0) + v;
const matched = rows.filter((r) => r.label === "matched");
const byLabel = (l: string) => { const x = rows.filter((r) => r.label === l && r.net_r != null); return { n: x.length, avgNetR: x.length ? Math.round((x.reduce((s, r) => s + Number(r.net_r), 0) / x.length) * 1000) / 1000 : null }; };
const report = {
  total,
  outcomeByLabel: { matched: byLabel("matched"), opposite: byLabel("rig-opposite-direction"), appOnly: byLabel("app-only-no-sweep-break") },
  matchedEntryVsBrokenLevelR: { median: median(matched.map((r) => r.entryVsBrokenR as number).filter((x) => x != null)) },
  perSymbol: out,
};
mkdirSync(new URL("../out/", import.meta.url).pathname, { recursive: true });
writeFileSync(new URL("../out/diff-vs-app.json", import.meta.url).pathname, JSON.stringify({ report, rows }, null, 1));
console.log(JSON.stringify(report, null, 1));
function median(x: number[]) { const s = [...x].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; }
