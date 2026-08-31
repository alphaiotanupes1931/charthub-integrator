// Shared types + parser for AI-generated chart visualizations.
// The AI streams fenced code blocks (```chart-annotations, ```concept-diagram,
// ```chart-grade); the client strips them from the visible text and renders
// them on the native chart / inline in chat.

export type ChartHLine = {
  kind: "hline";
  price: number;
  label?: string;
  color?: string;
  dashed?: boolean;
};

export type ChartZone = {
  kind: "zone";
  top: number;
  bottom: number;
  label?: string;
  color?: string; // hex, e.g. "#34d399"
};

export type ChartLabel = {
  kind: "label";
  price: number;
  text: string;
  color?: string;
};

export type ChartAnnotation = ChartHLine | ChartZone | ChartLabel;

export type ChartGrade = {
  grade: string; // A, B+, C, F, etc.
  bias?: "long" | "short" | "neutral";
  confidence?: number; // 0..100
  entry?: number;
  stop?: number;
  tp1?: number;
  tp2?: number;
  strength?: string;
  weakness?: string;
  dataSource?: string;
  dataFetchedAt?: string;
  candleCount?: number;
  /** Market price the plan was measured against, at dataFetchedAt. */
  refPrice?: number;
};

export type ConceptId =
  | "FVG"
  | "OrderBlock"
  | "LiquiditySweep"
  | "BOS"
  | "CHoCH"
  | "Fib"
  | "SR"
  | "Wyckoff";

export type ConceptRef = { id: ConceptId; note?: string };

export type ParsedAiPayload = {
  cleanText: string;
  annotations: ChartAnnotation[];
  concept?: ConceptRef;
  grade?: ChartGrade;
};

const FENCE_RE = /```([a-zA-Z-]+)\s*\n([\s\S]*?)```/g;
// Also match unterminated fences while the response is still streaming.
const OPEN_FENCE_RE = /```([a-zA-Z-]+)\s*\n([\s\S]*)$/;

const KNOWN_LANGS = new Set(["chart-annotations", "concept-diagram", "chart-grade"]);

function tryParse<T = unknown>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export function parseAiPayload(text: string): ParsedAiPayload {
  let annotations: ChartAnnotation[] = [];
  let concept: ConceptRef | undefined;
  let grade: ChartGrade | undefined;

  const clean = text.replace(FENCE_RE, (full, lang: string, body: string) => {
    const l = lang.toLowerCase();
    if (!KNOWN_LANGS.has(l)) return full;
    if (l === "chart-annotations") {
      const j = tryParse<{ items?: ChartAnnotation[] } | ChartAnnotation[]>(body);
      if (Array.isArray(j)) annotations = annotations.concat(j);
      else if (j && Array.isArray(j.items)) annotations = annotations.concat(j.items);
      return "";
    }
    if (l === "concept-diagram") {
      const j = tryParse<ConceptRef>(body);
      if (j?.id) concept = j;
      return "";
    }
    if (l === "chart-grade") {
      const j = tryParse<ChartGrade>(body);
      if (j?.grade) grade = j;
      return "";
    }
    return full;
  });

  // Hide the still-streaming fenced block so users don't see raw JSON.
  const openMatch = clean.match(OPEN_FENCE_RE);
  const finalClean = openMatch && KNOWN_LANGS.has(openMatch[1].toLowerCase())
    ? clean.slice(0, openMatch.index).trimEnd()
    : clean;

  return { cleanText: finalClean.trim(), annotations, concept, grade };
}

export const CONCEPT_LABELS: Record<ConceptId, string> = {
  FVG: "Fair Value Gap",
  OrderBlock: "Order Block",
  LiquiditySweep: "Liquidity Sweep",
  BOS: "Break of Structure",
  CHoCH: "Change of Character",
  Fib: "Fibonacci Retracement",
  SR: "Support / Resistance",
  Wyckoff: "Wyckoff Accumulation",
};

/**
 * Last line of defence for the grade card: a "short" plan must never display a
 * stop below entry with targets above it (and vice versa). Any producer — the
 * scan engine, a coach reply, or the sniper refinement — gets mirrored around
 * entry here so the card, the written plan, and the Setup chart lines always
 * describe the same trade.
 */
export function enforceGradeDirection(grade: ChartGrade | null): ChartGrade | null {
  if (!grade) return grade;
  const bias = grade.bias;
  if (bias !== "long" && bias !== "short") return grade;
  const { entry, stop } = grade;
  if (typeof entry !== "number" || !isFinite(entry) || typeof stop !== "number" || !isFinite(stop)) return grade;
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return grade;
  const stopWrong = bias === "long" ? stop >= entry : stop <= entry;
  const tp1Wrong =
    typeof grade.tp1 === "number" && isFinite(grade.tp1)
      ? bias === "long" ? grade.tp1 <= entry : grade.tp1 >= entry
      : false;
  if (!stopWrong && !tp1Wrong) return grade;
  const dir = bias === "long" ? 1 : -1;
  const tp1Dist = typeof grade.tp1 === "number" && isFinite(grade.tp1) ? Math.abs(grade.tp1 - entry) : risk * 1.5;
  const tp2Dist = typeof grade.tp2 === "number" && isFinite(grade.tp2) ? Math.abs(grade.tp2 - entry) : risk * 3;
  return {
    ...grade,
    stop: entry - dir * risk,
    tp1: entry + dir * Math.max(tp1Dist, risk * 1.5),
    tp2: entry + dir * Math.max(tp2Dist, risk * 3),
  };
}
