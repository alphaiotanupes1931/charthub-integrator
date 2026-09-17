// Measured hit rates for the coach to quote instead of inventing odds.
//
// Reads resolved rows from signal_scores across all users (the platform's own
// track record) and produces a compact prompt block: hit rate by grade for the
// instrument being discussed, plus the platform-wide grade lines as a fallback.
// Sample sizes are always included so a 2-trade bucket cannot be sold as an
// edge, and buckets with too little data are named as such.

type Row = {
  grade: string;
  status: string;
  realized_r: number | string | null;
  net_r?: number | string | null;
  taken?: boolean;
};

const MIN_SAMPLE = 8;

/**
 * Hit rate and average R are both computed over DECIDED rows only (target or
 * stop printed). Expiries are marked to the last close of a trade that never
 * concluded, so folding them into the average dilutes it with partial results.
 */
function stat(rows: Row[]) {
  let targets = 0;
  let stops = 0;
  let rSum = 0;
  let netSum = 0;
  let netCount = 0;
  for (const r of rows) {
    const isTarget = r.status === "target";
    const isStop = r.status === "stop";
    if (isTarget) targets += 1;
    else if (isStop) stops += 1;
    if (!isTarget && !isStop) continue;
    rSum += r.realized_r === null ? 0 : Number(r.realized_r);
    if (r.net_r !== null && r.net_r !== undefined) {
      netSum += Number(r.net_r);
      netCount += 1;
    }
  }
  const decided = targets + stops;
  return {
    total: rows.length,
    targets,
    stops,
    decided,
    hitRate: decided ? Math.round((targets / decided) * 1000) / 10 : null,
    avgR: decided ? Math.round((rSum / decided) * 100) / 100 : 0,
    netAvgR: netCount ? Math.round((netSum / netCount) * 100) / 100 : null,
    netCount,
  };
}

function gradeKey(grade: string): string | null {
  const g = (grade || "").toUpperCase();
  if (g === "A+" || g === "A") return "A/A+";
  if (g === "B") return "B";
  if (g === "C") return "C";
  return null;
}

function lineFor(label: string, rows: Row[]): string | null {
  const s = stat(rows);
  if (s.decided < MIN_SAMPLE) {
    return s.total
      ? `${label}: only ${s.decided} resolved signal${s.decided === 1 ? "" : "s"}, not enough to quote a hit rate.`
      : null;
  }
  return `${label}: ${s.hitRate}% hit rate over ${s.decided} resolved signals (${s.targets} hit target, ${s.stops} stopped), ${s.avgR}R average.`;
}

/**
 * Prompt block of real, resolved hit rates. `symbol` is the instrument being
 * discussed; pass undefined for a platform-only read.
 */
export async function measuredHitRatePrompt(symbol?: string, userId?: string): Promise<string> {
  let symbolRows: Row[] = [];
  let allRows: Row[] = [];
  let myRows: Array<Row & { user_id: string; taken: boolean }> = [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await (supabaseAdmin as never as {
      from: (t: string) => {
        select: (c: string) => {
          neq: (c: string, v: unknown) => {
            order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown }> };
          };
        };
      };
    })
      .from("signal_scores")
      .select("symbol, grade, status, realized_r, taken, user_id")
      .neq("status", "open")
      .order("created_at", { ascending: false })
      .limit(4000);
    const rows = ((res.data ?? []) as Array<Row & { symbol: string; user_id: string; taken: boolean }>).filter(Boolean);
    allRows = rows;
    if (symbol) symbolRows = rows.filter((r) => r.symbol === symbol);
    if (userId) myRows = rows.filter((r) => r.user_id === userId);
  } catch {
    return "";
  }
  if (!allRows.length) return "";

  const lines: string[] = [];
  const buckets: Array<[string, string]> = [["A/A+", "A and A+ grades"], ["B", "B grades"], ["C", "C grades"]];

  if (symbol && symbolRows.length) {
    lines.push(`MEASURED HIT RATE on ${symbol} (resolved from real bars, this platform's own scans):`);
    const overall = lineFor(`  ${symbol} all grades`, symbolRows);
    if (overall) lines.push(overall);
    for (const [key, label] of buckets) {
      const l = lineFor(`  ${symbol} ${label}`, symbolRows.filter((r) => gradeKey(r.grade) === key));
      if (l) lines.push(l);
    }
  }

  lines.push("MEASURED HIT RATE across all instruments:");
  const all = lineFor("  All grades", allRows);
  if (all) lines.push(all);
  for (const [key, label] of buckets) {
    const l = lineFor(`  ${label}`, allRows.filter((r) => gradeKey(r.grade) === key));
    if (l) lines.push(l);
  }
  // The trader's own filed scans, and the subset they actually traded. This is
  // the only honest answer to "my A trades keep stopping out".
  if (myRows.length) {
    const mine: string[] = [];
    const myAll = lineFor("  Your filed scans, all grades", myRows);
    if (myAll) mine.push(myAll);
    for (const [key, label] of buckets) {
      const l = lineFor(`  Your filed ${label}`, myRows.filter((r) => gradeKey(r.grade) === key));
      if (l) mine.push(l);
    }
    const taken = myRows.filter((r) => r.taken);
    if (taken.length) {
      const t = lineFor("  Trades you actually took, all grades", taken);
      if (t) mine.push(t);
      for (const [key, label] of buckets) {
        const l = lineFor(`  Trades you took, ${label}`, taken.filter((r) => gradeKey(r.grade) === key));
        if (l) mine.push(l);
      }
    } else {
      mine.push(
        "  None of this trader's journaled trades are linked to a filed scan yet, so there is NO measured record of how the trades they personally took performed. If they say a grade keeps losing for them, say plainly that their own taken-trade record is not measured yet, quote the filed-scan numbers above instead, and ask them to log their trades so it can be measured.",
      );
    }
    if (mine.length) {
      lines.push("THIS TRADER'S OWN RECORD:");
      lines.push(...mine);
    }
  }

  lines.push(
    "Quote ONLY these numbers when the trader asks about odds, likelihood, or how often a grade works. Never invent a percentage. If the relevant bucket has too little data, say plainly that there is not enough resolved history yet.",
  );
  return lines.join("\n");
}
