/**
 * Plain-language note on how a setup sits against the higher timeframes.
 *
 * Two different questions were being answered by one flag:
 *  - "is this fighting the 4H?"  (the existing hard gate)
 *  - "is this fighting the DAILY bias?"  (what a trader means by counter-trend)
 *
 * A daily bias down with a 4H trending up is usually a retracement INTO the next
 * sell, not a fresh buy trend. That case is labelled explicitly here so the
 * trader can see which of the three situations they are looking at. This is a
 * label only: grading, entries and stops are unchanged.
 */

export type TrendDirection = string | undefined | null;

export type TrendRelation = {
  /** Short badge text. */
  label: "With the daily bias" | "Against the daily bias" | "Counter-trend" | "Daily bias unclear";
  /** One sentence the trader can read. */
  note: string;
  /** True when the trade fights the daily bias. */
  againstDaily: boolean;
  /** True when it fights both the daily bias and the 4H. */
  counterTrend: boolean;
  /** True when the 4H points the other way to the daily bias. */
  pullbackIntoDaily: boolean;
};

const norm = (v: TrendDirection): "bullish" | "bearish" | "neutral" => {
  const s = String(v ?? "").toLowerCase();
  if (s === "bullish" || s === "up" || s === "long") return "bullish";
  if (s === "bearish" || s === "down" || s === "short") return "bearish";
  return "neutral";
};

export function classifyTrendRelation(input: {
  bias: string;
  dailyBias: TrendDirection;
  h4Direction: TrendDirection;
}): TrendRelation {
  const wanted = norm(input.bias);
  const daily = norm(input.dailyBias);
  const h4 = norm(input.h4Direction);
  const opposite = wanted === "bullish" ? "bearish" : "bullish";

  if (wanted === "neutral" || daily === "neutral") {
    return {
      label: "Daily bias unclear",
      note: "No clean daily direction to judge this against, so it is neither with nor against the daily bias.",
      againstDaily: false,
      counterTrend: false,
      pullbackIntoDaily: h4 !== "neutral" && daily !== "neutral" && h4 !== daily,
    };
  }

  const againstDaily = daily === opposite;
  const pullbackIntoDaily = h4 !== "neutral" && h4 !== daily;

  if (!againstDaily) {
    return {
      label: "With the daily bias",
      note: `The daily bias is ${daily} and this is a ${wanted === "bullish" ? "buy" : "sell"}, so it trades with the higher-timeframe direction.`,
      againstDaily: false,
      counterTrend: false,
      pullbackIntoDaily,
    };
  }

  if (h4 === wanted) {
    return {
      label: "Against the daily bias",
      note: `The daily bias is ${daily} while the 4H is ${h4}. This is a retracement inside the daily move, not a new trend — the bigger trade is still the ${daily === "bearish" ? "sell" : "buy"} that follows the daily bias.`,
      againstDaily: true,
      counterTrend: false,
      pullbackIntoDaily: true,
    };
  }

  return {
    label: "Counter-trend",
    note: `Both the daily bias (${daily}) and the 4H (${h4}) point the other way, so this fights the whole higher-timeframe picture.`,
    againstDaily: true,
    counterTrend: true,
    pullbackIntoDaily: false,
  };
}
