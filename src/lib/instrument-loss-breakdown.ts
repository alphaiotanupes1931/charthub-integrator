// Read-only loss breakdown per instrument. Pure. Decided signals only
// (stop/target); Neutral, void, unfilled, open and expired are excluded.
//
// Exit what-ifs use stored MFE. For a stopped trade we assume MFE printed
// before the stop, so results are an upper bound until bar-order replay.

export type LossRow = {
  symbol: string;
  status: string;
  side: "long" | "short";
  netR: number;
  costR: number;
  mfeR: number | null;
  createdAt: string;
};

export type ExitVariant = "base" | "tp_1r" | "be_at_1r";

export function variantR(r: LossRow, v: ExitVariant): number {
  if (v === "base" || r.mfeR == null) return r.netR;
  const reached = r.mfeR >= 1;
  if (v === "tp_1r") return (reached ? 1 : -1) - r.costR;
  // be_at_1r: winners keep their result, stopped trades that reached 1R scratch.
  if (r.status === "target") return r.netR;
  return reached ? -r.costR : r.netR;
}

export type Cell = { n: number; totalR: number; avgR: number; enough: boolean };

const MIN_CELL = 30;

function cell(rows: LossRow[], v: ExitVariant): Cell {
  const total = rows.reduce((s, r) => s + variantR(r, v), 0);
  return { n: rows.length, totalR: total, avgR: rows.length ? total / rows.length : 0, enough: rows.length >= MIN_CELL };
}

export function breakdown(all: LossRow[], symbol: string) {
  const rows = all
    .filter((r) => r.symbol === symbol && (r.status === "stop" || r.status === "target"))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mid = Math.floor(rows.length / 2);
  const variants: ExitVariant[] = ["base", "tp_1r", "be_at_1r"];
  const byVariant = Object.fromEntries(
    variants.map((v) => [v, { pooled: cell(rows, v), firstHalf: cell(rows.slice(0, mid), v), heldOut: cell(rows.slice(mid), v) }]),
  ) as Record<ExitVariant, { pooled: Cell; firstHalf: Cell; heldOut: Cell }>;
  return {
    symbol,
    bySide: { long: cell(rows.filter((r) => r.side === "long"), "base"), short: cell(rows.filter((r) => r.side === "short"), "base") },
    costShare: rows.reduce((s, r) => s + r.costR, 0),
    byVariant,
    comparisonsRun: variants.length * 3,
  };
}
