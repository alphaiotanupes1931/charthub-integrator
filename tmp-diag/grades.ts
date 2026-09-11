import { getSnapshot } from "../src/lib/agents/market-data.server";
import { countEvidence, collectGradeCaps, gradeFromEvidence } from "../src/lib/agents/planner.server";
import { computeBias } from "../src/lib/agents/bias-adapter.server";
const memo:any = { consensus: "neutral", bullets: [], sources: [] };
const tickers = ["XAUUSD","EURUSD","GBPUSD","USDJPY","NAS100","US30","BTCUSD"];
for (const t of tickers) {
  try {
    const snap = await getSnapshot(t, "60");
    const bias:any = snap.mtf?.h4.direction === "bullish" ? "Long" : snap.mtf?.h4.direction === "bearish" ? "Short" : "Long";
    for (const rr of [2.0]) {
      const conf = countEvidence(snap, memo, "B", bias, rr);
      const caps = collectGradeCaps(bias, snap);
      const g = gradeFromEvidence(bias, conf, snap);
      let engineMax = "?";
      try { engineMax = computeBias(snap, "A").result.mtf.maxGrade; } catch {}
      console.log(t, bias, "conf", conf, "grade", g, "engineMax", engineMax, "caps", caps.map(c=>`${c.label}=>${c.cap}`).join(" | ") || "none");
    }
  } catch (e:any) { console.log(t, "ERR", e?.message); }
}
