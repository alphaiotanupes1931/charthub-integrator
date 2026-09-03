import { getSnapshot } from "../src/lib/agents/market-data.server";
for (const s of ["NAS100","US30"]) {
  const snap = await getSnapshot(s, "240");
  console.log("=== "+s+" last 10 4H closed candles");
  for (const c of snap.candles.slice(-10)) console.log(new Date(c.time*1000).toISOString(), c.open.toFixed(1), c.high.toFixed(1), c.low.toFixed(1), c.close.toFixed(1));
  const h1 = await getSnapshot(s, "60");
  const today = h1.candles.filter(c => new Date(c.time*1000).toISOString().slice(0,10) === "2026-09-03");
  if (today.length) console.log(s, "today 1H: open", today[0].open.toFixed(1), "->", today.at(-1)!.close.toFixed(1), "range", Math.min(...today.map(c=>c.low)).toFixed(1), Math.max(...today.map(c=>c.high)).toFixed(1));
  console.log(s, "mtf", JSON.stringify({h4:h1.mtf?.h4, h1:h1.mtf?.h1, m15:h1.mtf?.m15, align:h1.mtf?.alignment}));
}
