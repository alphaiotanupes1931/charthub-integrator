import { getSnapshot } from "../src/lib/agents/market-data.server";
import { sessionVolumeRead } from "../src/lib/sessionVolume";
for (const t of ["NAS100","US30"]) {
  const s = await getSnapshot(t, "60");
  const r = sessionVolumeRead(s.candles as never);
  console.log(t, JSON.stringify(r));
}
