// Scan Lens - analysis emphasis filter applied to AI chart reads.
// Persisted per-browser in localStorage and injected into the chat system prompt.

export type ScanLensId =
  | "wyckoff"
  | "accum"
  | "dist"
  | "trend"
  | "range"
  | "fib"
  | "cisd";

export type ScanLens = {
  id: ScanLensId;
  name: string;
  short: string;
  desc: string;
  promptEmphasis: string;
};

export const SCAN_LENSES: ScanLens[] = [
  {
    id: "wyckoff",
    name: "Wyckoff Core",
    short: "Wyckoff",
    desc: "Pure institutional phase detection. No overlay bias.",
    promptEmphasis:
      "Use a strict Wyckoff lens. Identify the current phase (A/B/C/D/E), name the schematic, and grade Sweep -> BOS -> Retest with zero deviation. Do not impose direction unless the phase warrants it.",
  },
  {
    id: "accum",
    name: "Accumulation Specialist",
    short: "Accum",
    desc: "Spring + BOS in uptrends. Demand absorption.",
    promptEmphasis:
      "Bias toward accumulation. Hunt for Spring, Test, and Sign of Strength inside ranges that sit at HTF demand. Only call shorts if the chart screams distribution.",
  },
  {
    id: "dist",
    name: "Distribution Specialist",
    short: "Dist",
    desc: "Upthrust + BOS in downtrends. Supply absorption.",
    promptEmphasis:
      "Bias toward distribution. Hunt Upthrust, UTAD, and Sign of Weakness inside ranges at HTF supply. Only call longs if the chart screams accumulation.",
  },
  {
    id: "trend",
    name: "Trend Trader",
    short: "Trend",
    desc: "Breakout + retest in established trends. Momentum aligned.",
    promptEmphasis:
      "Trend-following lens. Require an established HTF trend, then look for breakout + retest entries aligned with it. Skip range fades; flag mean-reversion setups as off-lens.",
  },
  {
    id: "range",
    name: "Range Trader",
    short: "Range",
    desc: "Wick extremes inside consolidation. Mean reversion.",
    promptEmphasis:
      "Mean-reversion lens. Treat consolidation ranges as the primary structure. Fade wick extremes back to range mid / opposite edge. Flag breakouts as off-lens unless they fail back inside.",
  },
  {
    id: "fib",
    name: "Fibonacci Confluence",
    short: "Fib",
    desc: "Adds Fib retracement + extension targets. Wyckoff still core.",
    promptEmphasis:
      "Layer Fibonacci retracement (0.5 / 0.618 / 0.786) and extensions (1.272 / 1.618) on top of the Wyckoff read. Targets and stops should reference Fib levels explicitly.",
  },
];

export const DEFAULT_LENS_ID: ScanLensId = "wyckoff";

const KEY = "trademind.scanLens.v1";

export function readActiveLensId(): ScanLensId {
  if (typeof window === "undefined") return DEFAULT_LENS_ID;
  try {
    const v = window.localStorage.getItem(KEY) as ScanLensId | null;
    if (v && SCAN_LENSES.some((l) => l.id === v)) return v;
  } catch { /* ignore */ }
  return DEFAULT_LENS_ID;
}

export function writeActiveLensId(id: ScanLensId) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, id); } catch { /* ignore */ }
}

export function findLens(id: string | null | undefined): ScanLens {
  return SCAN_LENSES.find((l) => l.id === id) ?? SCAN_LENSES[0];
}
