// Readability audit for the chart palette.
//
// Axis prices, time labels and the grid are drawn straight from the chart
// background colours, so a custom hex combo can leave the numbers almost
// invisible. We score them with the standard WCAG contrast ratio and suggest a
// preset that is comfortably readable instead of leaving the trader squinting.

import { CHART_BG_PRESETS, type ChartBackground } from "@/hooks/useChartBackground";

function toRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Axis text is small, so we hold it to the AA small-text bar. */
export const TEXT_MIN_RATIO = 4.5;
/** Gridlines are deliberately subtle; only flag ones that vanish entirely.
 * Every shipped preset sits at 1.10-1.21, so the bar stays below that. */
export const GRID_MIN_RATIO = 1.05;

export type ChartContrastIssue = {
  id: "text" | "grid";
  label: string;
  ratio: number;
  min: number;
};

export type ChartContrastAudit = {
  textRatio: number;
  gridRatio: number;
  issues: ChartContrastIssue[];
  /** Preset name that reads best while staying in the same light/dark family. */
  suggestion: string | null;
  suggestionRatio: number;
};

function isDark(hex: string): boolean {
  return luminance(hex) < 0.4;
}

/**
 * Best-reading preset in the same light/dark family as the current background,
 * so auto-switching never flips a light chart to dark under the trader.
 */
export function suggestReadablePreset(colors: ChartBackground): { name: string | null; ratio: number } {
  const wantDark = isDark(colors.bg);
  let best: { name: string | null; ratio: number } = { name: null, ratio: 0 };
  for (const [name, preset] of Object.entries(CHART_BG_PRESETS)) {
    if (isDark(preset.bg) !== wantDark) continue;
    const ratio = contrastRatio(preset.text, preset.bg);
    if (ratio > best.ratio) best = { name, ratio };
  }
  // No same-family preset clears the bar: allow the other family rather than
  // leaving the trader with unreadable axis prices.
  if (best.ratio < TEXT_MIN_RATIO) {
    for (const [name, preset] of Object.entries(CHART_BG_PRESETS)) {
      const ratio = contrastRatio(preset.text, preset.bg);
      if (ratio > best.ratio) best = { name, ratio };
    }
  }
  return best;
}

export function auditChartContrast(colors: ChartBackground): ChartContrastAudit {
  const textRatio = contrastRatio(colors.text, colors.bg);
  const gridRatio = contrastRatio(colors.grid, colors.bg);
  const issues: ChartContrastIssue[] = [];
  if (textRatio < TEXT_MIN_RATIO) {
    issues.push({ id: "text", label: "Price and time labels", ratio: textRatio, min: TEXT_MIN_RATIO });
  }
  if (gridRatio < GRID_MIN_RATIO) {
    issues.push({ id: "grid", label: "Gridlines", ratio: gridRatio, min: GRID_MIN_RATIO });
  }
  const suggestion = suggestReadablePreset(colors);
  const better = suggestion.name && suggestion.ratio > textRatio + 0.2 ? suggestion.name : null;
  return {
    textRatio,
    gridRatio,
    issues,
    suggestion: issues.length ? better : null,
    suggestionRatio: suggestion.ratio,
  };
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)}:1`;
}
