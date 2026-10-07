// Day 1: OANDA candle store. M15 + H1, bid/ask/mid (price=MBA), back to 2015.
// One gz JSONL file per instrument/timeframe; reruns only fetch newer bars.
// Run: bun research/rig/download.ts [M15,H1] [XAU_USD,...]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";

export const RIG_INSTRUMENTS = ["XAU_USD", "XAG_USD", "EUR_USD", "GBP_USD", "USD_JPY", "NAS100_USD", "SPX500_USD", "US30_USD", "BTC_USD"];
export type RigBar = { t: number; o: number; h: number; l: number; c: number; v: number; bo: number; bc: number; ao: number; ac: number; bh: number; bl: number; ah: number; al: number };
const DIR = new URL("../data/", import.meta.url).pathname;
export const storePath = (inst: string, tf: string) => `${DIR}${inst}_${tf}.jsonl.gz`;

export function loadBars(inst: string, tf: string): RigBar[] {
  const p = storePath(inst, tf);
  if (!existsSync(p)) return [];
  return gunzipSync(readFileSync(p)).toString().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const host = () => (process.env.OANDA_ENV === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com");

export async function fetchRange(inst: string, tf: string, fromSec: number, toSec?: number): Promise<RigBar[]> {
  const out: RigBar[] = [];
  let from = Math.floor(fromSec);
  const end = toSec ?? Math.floor(Date.now() / 1000);
  for (;;) {
    const u = `${host()}/v3/instruments/${inst}/candles?price=MBA&granularity=${tf}${toSec ? `&from=${from}&to=${end}` : `&count=5000&from=${from}`}`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${process.env.OANDA_API_KEY}`, "Accept-Datetime-Format": "UNIX" } });
    if (!r.ok) throw new Error(`${inst} ${tf} ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { candles: Array<{ time: string; complete: boolean; volume: number; mid: Record<string, string>; bid: Record<string, string>; ask: Record<string, string> }> };
    const done = j.candles.filter((c) => c.complete);
    let past = false;
    for (const c of done) {
      const t = Math.floor(Number(c.time.split(".")[0]));
      if (t > end) { past = true; break; }
      out.push({ t, o: +c.mid.o, h: +c.mid.h, l: +c.mid.l, c: +c.mid.c, v: c.volume, bo: +c.bid.o, bc: +c.bid.c, bh: +c.bid.h, bl: +c.bid.l, ao: +c.ask.o, ac: +c.ask.c, ah: +c.ask.h, al: +c.ask.l });
    }
    if (past || j.candles.length < 5000 || !done.length) break;
    from = out[out.length - 1]!.t + 1;
    if (from > end) break;
  }
  return out;
}

async function main() {
  const tfs = (process.argv[2] ?? "M15,H1").split(",");
  const insts = (process.argv[3] ?? RIG_INSTRUMENTS.join(",")).split(",");
  mkdirSync(DIR, { recursive: true });
  for (const inst of insts) for (const tf of tfs) {
    const have = loadBars(inst, tf);
    const from = have.length ? have[have.length - 1]!.t + 1 : Date.UTC(2015, 0, 1) / 1000;
    const add = await fetchRange(inst, tf, from);
    const all = [...have, ...add];
    writeFileSync(storePath(inst, tf), gzipSync(all.map((b) => JSON.stringify(b)).join("\n")));
    console.log(inst, tf, "have", have.length, "added", add.length, "total", all.length);
  }
}
if (import.meta.main) await main();
