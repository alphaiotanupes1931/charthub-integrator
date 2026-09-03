import { getSnapshot } from "../src/lib/agents/market-data.server";
import { formatLadder } from "../src/lib/agents/market-data.server";
const s = await getSnapshot("XAU/USD", "60");
console.log(formatLadder((s.mtf as never as {ladder:never[]}).ladder));
console.log("h4", JSON.stringify((s.mtf as never as {h4:{direction:string;trend:string}}).h4.direction), (s.mtf as never as {h4:{trend:string}}).h4.trend, "align", (s.mtf as never as {alignment:string}).alignment);
