import { getSnapshot } from "../src/lib/agents/market-data.server";
import { runResearch } from "../src/lib/agents/research.server";
import { runPlanner } from "../src/lib/agents/planner.server";
const key = process.env.LOVABLE_API_KEY!;
const snap = await getSnapshot("XAU/USD", "60");
const memo = await runResearch(key, snap);
const p = await runPlanner(key, snap, memo);
console.log("grade="+p.grade,"bias="+p.bias,"conf="+p.confidence,"entry="+p.entry,"stop="+p.stop,"tp1="+p.tp1);
console.log("notes:", JSON.stringify(p).slice(0,900));
