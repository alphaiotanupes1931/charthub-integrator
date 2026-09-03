import { getSnapshot } from "../src/lib/agents/market-data.server";
import { readSessionVolume } from "../src/lib/sessionVolume";
for (const tf of ["240","60","15"]) {
  const s = await getSnapshot("XAU/USD", tf);
  const m = s.mtf as never as Record<string, never>;
  console.log("tf="+tf, "src="+s.source, "bars="+s.candles.length, "last="+s.candles.at(-1)?.close,
    "lastBar="+new Date((s.candles.at(-1)?.time ?? 0)*1000).toISOString());
  console.log("  mtf=", JSON.stringify(s.mtf));
  console.log("  sess=", JSON.stringify(readSessionVolume(s.candles as never)));
}
