import { useEffect, useMemo, useState } from "react";
import { useChartBackground } from "@/hooks/useChartBackground";
import { luminance } from "@/lib/chartContrast";

export type ChartTheme = "light" | "dark";

/** Reads the app theme straight off <html>, so it works no matter which
 * component flipped the class (useTheme keeps its state locally). */
function readAppTheme(): ChartTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

/** A palette is "light" when its background is bright enough that dark chart
 * chrome would sit on top of it and wash the labels out. */
export function isLightBackground(bg: string): boolean {
  return luminance(bg) > 0.35;
}

/**
 * Resolves the light/dark mode the embedded TradingView chart must use.
 *
 * The embed paints its own axes, toolbar and crosshair labels, so if its theme
 * disagrees with the surrounding UI you get dark grey text on a white panel
 * (or the reverse) and the prices become unreadable. We follow the chart
 * palette first — that is what the trader picked for chart surfaces — and fall
 * back to the app theme when the palette is a neutral dark one.
 */
export function useChartTheme() {
  const { colors } = useChartBackground();
  const [appTheme, setAppTheme] = useState<ChartTheme>("dark");

  useEffect(() => {
    setAppTheme(readAppTheme());
    const observer = new MutationObserver(() => setAppTheme(readAppTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return useMemo(() => {
    const paletteLight = isLightBackground(colors.bg);
    const theme: ChartTheme = paletteLight ? "light" : appTheme === "light" ? "light" : "dark";
    // The embed wants bare hex for the toolbar. Keep it on the palette so the
    // widget chrome matches the panel it sits in.
    const toolbarBg = colors.bg.replace("#", "");
    return {
      theme,
      toolbarBg,
      /** Hex text colour that stays legible over the resolved theme. */
      labelColor: colors.text,
      appTheme,
      paletteLight,
    };
  }, [colors.bg, colors.text, appTheme]);
}
