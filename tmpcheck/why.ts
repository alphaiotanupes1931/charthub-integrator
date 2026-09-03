import { getSnapshot } from "../src/lib/agents/market-data.server";
import { readSessionVolume } from "../src/lib/sessionVolume";
for (const t of ["NAS100","US30"]) {
  const s = await getSnapshot(t, "60");
  const r = readSessionVolume(s.candles as never);
  console.log(t, JSON.stringify(r));
}
