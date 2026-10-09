// Builds the coach's running memory of a trader from their scans, journal and
// chats. Pure so it can be tested; the server loader feeds it rows.

export type MemoryScan = { symbol: string; grade: string | null; taken: boolean; status: string | null; realizedR: number | null };
export type MemoryTrade = { symbol: string; result?: string | null; resultR?: number | null; stopMoved: boolean };

export type TraderMemory = {
  scans: number;
  taken: number;
  takenWinRate: number | null;
  skippedWinners: number;
  topSymbols: string[];
  trades: number;
  stopMoves: number;
  stopMoveLosses: number;
  recentTopics: string[];
};

const resolved = (s: string | null) => s === "target" || s === "stop";

export function buildTraderMemory(scans: MemoryScan[], trades: MemoryTrade[], userMessages: string[]): TraderMemory {
  const takenScans = scans.filter((s) => s.taken);
  const takenResolved = takenScans.filter((s) => resolved(s.status));
  const counts = new Map<string, number>();
  for (const s of scans) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
  const moved = trades.filter((t) => t.stopMoved);
  return {
    scans: scans.length,
    taken: takenScans.length,
    takenWinRate: takenResolved.length ? takenResolved.filter((s) => s.status === "target").length / takenResolved.length : null,
    skippedWinners: scans.filter((s) => !s.taken && s.status === "target").length,
    topSymbols: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
    trades: trades.length,
    stopMoves: moved.length,
    stopMoveLosses: moved.filter((t) => t.result === "stop").length,
    recentTopics: userMessages.map((m) => m.replace(/\s+/g, " ").trim()).filter((m) => m.length > 8).slice(0, 6).map((m) => m.slice(0, 140)),
  };
}

export function traderMemoryPromptBlock(m: TraderMemory): string {
  if (!m.scans && !m.trades && !m.recentTopics.length) return "";
  const lines = ["TRADER MEMORY (last 60 days, built from their scans, journal and chats; use it to personalise, don't recite it):"];
  if (m.scans) {
    lines.push(`- Ran ${m.scans} scans, took ${m.taken}.${m.takenWinRate != null ? ` Taken setups won ${Math.round(m.takenWinRate * 100)}% of resolved.` : ""}`);
    if (m.skippedWinners) lines.push(`- ${m.skippedWinners} setups they skipped went on to hit target.`);
    if (m.topSymbols.length) lines.push(`- Most-scanned: ${m.topSymbols.join(", ")}.`);
  }
  if (m.trades) {
    lines.push(`- Logged ${m.trades} journal trades; moved the stop or target after logging on ${m.stopMoves}${m.stopMoves ? ` (${m.stopMoveLosses} of those still stopped out)` : ""}.`);
  }
  if (m.recentTopics.length) lines.push(`- Recent things they asked about: ${m.recentTopics.map((t) => `"${t}"`).join("; ")}`);
  return lines.join("\n");
}
