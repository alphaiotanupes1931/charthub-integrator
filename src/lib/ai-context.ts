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
    // Older cards were saved without a symbol field; the reply's opening line
    // ("Gold Spot scan: B Short.") still names the instrument, so fall back to it.
    const fallbackSymbol = text.match(/^(.{1,40}?) scan:/m)?.[1]?.trim() ?? null;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          if (!parsed["symbol"] && fallbackSymbol) parsed["symbol"] = fallbackSymbol;
          raw.push({ turn: i + 1, scan: parsed });
        }
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
    // Levels saved by older scans can carry float noise (4348.450000000001);
    // trim it so both the panel and the model recap read like prices.
    const level = (...keys: string[]) => {
      const v = get(...keys);
      if (v === null) return null;
      const n = Number(v);
      if (!isFinite(n)) return v;
      const abs = Math.abs(n);
      const dec = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
      return String(Number(n.toFixed(dec)));
    };
    return {
      turn,
      symbol: get("symbol", "ticker"),
      timeframe: get("timeframe", "interval"),
      grade: get("grade"),
      bias: get("bias"),
      confidence: get("confidence"),
      entry: level("entry"),
      stop: level("stop"),
      tp1: level("tp1"),
      tp2: level("tp2"),
      rr: get("rr"),
      refPrice: level("refPrice"),
      scannedAt: get("dataFetchedAt", "scannedAt"),
      synopsis: get("synopsis", "rationale", "reason"),
      included: idx >= cutoff,
    };
  });
}

/**
 * Plain-text recap of the scans already in this thread.
 *
 * Grades and directions are deliberately NOT included. That is rule 6 of the v3
 * bias fix: on 2026-09-03 GBP/USD stayed short for three scans because the model
 * could read its own earlier SHORT verdicts. Levels are kept, because a trader
 * managing an open position needs the entry and stop they were given; direction
 * and grade come only from the freshly computed bias block.
 */
export function priorScansBlock(messages: ChatLikeMessage[]): string {
  const included = extractPriorScans(messages).filter((s) => s.included);
  if (included.length === 0) return "";

  const lines = included.map((s, idx) => {
    const bits = [
      s.symbol,
      s.timeframe,
      s.entry ? `entry ${s.entry}` : null,
      s.stop ? `stop ${s.stop}` : null,
      s.tp1 ? `TP1 ${s.tp1}` : null,
      s.tp2 ? `TP2 ${s.tp2}` : null,
      s.refPrice ? `price used ${s.refPrice}` : null,
      s.scannedAt ? `scanned ${s.scannedAt}` : null,
    ].filter(Boolean);
    const label = idx === included.length - 1 ? "most recent scan" : `scan ${idx + 1}`;
    return `- [${label}, message ${s.turn}] ${bits.join(", ")}`;
  });

  return [
    "LEVELS FROM EARLIER SCANS IN THIS THREAD (you DO have these - never say you lack the previous scan):",
    ...lines,
    "When the trader references \"the scan\", \"that setup\", or \"the grade\", they mean the most recent entry above. Quote its actual levels.",
    "The DIRECTION and GRADE of every earlier scan are VOID and are not shown to you on purpose. Never restate or defend an earlier bias. Direction comes only from the authoritative bias block computed for this turn.",
    "If the current computed bias disagrees with a setup the trader is already in, say plainly that the market moved and what changed.",
  ].join("\n");
}

const SCAN_BLOCK_RE = /```chart-grade\s*[\s\S]*?```/g;

/**
 * Removes prior scan payloads and directional verdict lines from assistant turns
 * before the transcript is handed to the model. The trader still sees the full
 * history in the UI; only the model's copy is scrubbed.
 */
export function voidPriorScanVerdicts<T extends { role: string; parts?: unknown }>(messages: T[]): T[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.parts)) return m;
    let touched = false;
    const parts = (m.parts as Array<{ type: string; text?: string }>).map((p) => {
      if (p.type !== "text" || typeof p.text !== "string") return p;
      let text = p.text.replace(SCAN_BLOCK_RE, "[prior scan payload removed. Its bias and grade are void.]");
      // "Gold Spot scan: B Short." style verdict headers carry the same lock.
      text = text.replace(
        /^(.{1,40}?) scan:\s*(A\+|A|B|C|D|F|NO ENTRY)?\s*(long|short|neutral)?\.?/gim,
        "$1 scan: [earlier verdict void]",
      );
      if (text !== p.text) touched = true;
      return { ...p, text };
    });
    return touched ? ({ ...m, parts } as T) : m;
  });
}

