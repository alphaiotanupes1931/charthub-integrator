// Rules for the daily scan log: every scan is filed, but only a directional
// call keeps trade levels. A Neutral or NO ENTRY read is stored as "no_trade"
// with its levels cleared, so it can never look like a setup in the review.

export type ScanLogInput = {
  bias: string;
  grade: string;
  entry?: number | null;
  stop?: number | null;
  tp1?: number | null;
  tp2?: number | null;
};

export type NormalizedScanLevels = {
  bias: "Long" | "Short" | "Neutral";
  directional: boolean;
  entry: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  status: "open" | "no_trade";
};

const finite = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

export function normalizeScanLevels(input: ScanLogInput): NormalizedScanLevels {
  const b = (input.bias ?? "").trim().toLowerCase();
  const bias = b === "long" ? "Long" : b === "short" ? "Short" : "Neutral";
  const entry = finite(input.entry);
  const stop = finite(input.stop);
  const tp1 = finite(input.tp1);
  const directional =
    bias !== "Neutral" && input.grade.trim().toUpperCase() !== "NO ENTRY" && !!entry && !!stop && !!tp1;
  if (!directional) {
    return { bias, directional: false, entry: null, stop: null, tp1: null, tp2: null, status: "no_trade" };
  }
  return { bias, directional: true, entry, stop, tp1, tp2: finite(input.tp2), status: "open" };
}
