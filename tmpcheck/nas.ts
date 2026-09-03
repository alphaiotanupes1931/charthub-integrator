import { getSnapshot } from "../src/lib/agents/market-data.server";
for (const s of ["NAS100","US30"]) {
  for (const tf of ["240","60","15"]) {
    try {
      const snap = await getSnapshot(s, tf);
      const last = snap.candles.at(-1)!;
      console.log(s, tf, "src="+snap.source, "bars="+snap.candles.length, "last="+snap.lastPrice,
        "lastBar="+new Date(last.time*1000).toISOString(), "atr="+snap.stats.atr14.toFixed(1),
        "trend4h="+(snap.mtf?.h4?.trend ?? "?"), "align="+(snap.mtf?.alignment ?? "?"));
    } catch (e) { console.log(s, tf, "ERR", (e as Error).message); }
  }
}
