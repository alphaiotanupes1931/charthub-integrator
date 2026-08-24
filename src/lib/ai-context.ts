// Shared prior-scan context. The chat route builds the model's system block
// from these helpers, and the AI context inspector in the UI renders the same
// list, so what a trader sees is exactly what the coach was handed.

export type PriorScan = {
  /** 1-based message index in the thread the scan was parsed from. */
  turn: number;
  symbol: string | null;
  timeframe: string | null;
  grade: string | null;
  bias: string | null;
  confidence: string | null;
  entry: string | null;
  stop: string | null;
  tp1: string | null;
  tp2: string | null;
  rr: string | null;
  refPrice: string | null;
  scannedAt: string | null;
  synopsis: string | null;
  /** False when the scan was trimmed out of the model window. */
  included: boolean;
};

type ChatLikeMessage = {
  role: string;
  parts?: Array<{ type: string; text?: string }> | unknown;
};

/** How many of the newest scans are handed to the model. */
export const PRIOR_SCAN_LIMIT = 6;

function textOf(m: ChatLikeMessage): string {
  const parts = (Array.isArray(m.parts) ? m.parts : []) as Array<{ type: string; text?: string }>;
  return parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
}

/**
 * Every fenced chart-grade block already in the thread, oldest first, flagged
 * with whether it survived the model window.
 */
export function extractPriorScans(messages: ChatLikeMessage[]): PriorScan[] {
  const raw: Array<{ turn: number; scan: Record<string, unknown> }> = [];
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const re = /```chart-grade\s*([\s\S]*?)```/g;
    const text = textOf(m);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") raw.push({ turn: i + 1, scan: parsed });
      } catch {
        /* ignore malformed block */
      }
    }
  });

  const cutoff = Math.max(0, raw.length - PRIOR_SCAN_LIMIT);
  return raw.map(({ turn, scan }, idx) => {
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = scan[k];
        if (v !== null && v !== undefined && v !== "") return String(v);
      }
      return null;
    };
    return {
      turn,
      symbol: get("symbol", "ticker"),
      timeframe: get("timeframe", "interval"),
      grade: get("grade"),
      bias: get("bias"),
      confidence: get("confidence"),
      entry: get("entry"),
      stop: get("stop"),
      tp1: get("tp1"),
      tp2: get("tp2"),
      rr: get("rr"),
      refPrice: get("refPrice"),
      scannedAt: get("dataFetchedAt", "scannedAt"),
      synopsis: get("synopsis", "rationale", "reason"),
      included: idx >= cutoff,
    };
  });
}

/**
 * Plain-text recap of the scans already in this thread. Without it the model
 * treats the fenced JSON as opaque and claims it lacks the previous scan.
 */
export function priorScansBlock(messages: ChatLikeMessage[]): string {
  const included = extractPriorScans(messages).filter((s) => s.included);
  if (included.length === 0) return "";

  const lines = included.map((s, idx) => {
    const bits = [
      s.symbol,
      s.timeframe,
      s.grade ? `grade ${s.grade}` : null,
      s.bias ? `bias ${s.bias}` : null,
      s.confidence ? `confidence ${s.confidence}` : null,
      s.entry ? `entry ${s.entry}` : null,
      s.stop ? `stop ${s.stop}` : null,
      s.tp1 ? `TP1 ${s.tp1}` : null,
      s.tp2 ? `TP2 ${s.tp2}` : null,
      s.rr ? `R:R ${s.rr}` : null,
      s.refPrice ? `price used ${s.refPrice}` : null,
      s.scannedAt ? `scanned ${s.scannedAt}` : null,
      s.synopsis,
    ].filter(Boolean);
    const label = idx === included.length - 1 ? "most recent scan" : `scan ${idx + 1}`;
    return `- [${label}, message ${s.turn}] ${bits.join(", ")}`;
  });

  return [
    "PREVIOUS SCANS IN THIS THREAD (you DO have this - never say you lack the previous scan):",
    ...lines,
    "When the trader references \"the scan\", \"that setup\", or \"the grade\", they mean the most recent entry above. Quote its actual numbers.",
    "Grades and levels are point-in-time reads. If a fresh scan disagrees with an earlier one, say plainly that the market moved and what changed, do not pretend the earlier read never happened.",
  ].join("\n");
}
