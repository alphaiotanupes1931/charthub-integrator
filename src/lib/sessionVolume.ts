// Session-aware volume filters for the grading engine.
//
// A structurally correct setup is still unplayable when the tape is thin: the
// Sydney/Tokyo Gold shorts that kept getting stopped were graded B with a
// 0.6x ATR stop while the last bars traded 0.21-0.70x their session median.
// These helpers measure that condition off the raw candles so grading can
// stand down, widen stops, or warn instead of shipping tight risk into air.

export type SessionName = "Sydney" | "Tokyo" | "London" | "New York";

export type VolCandle = { time: number; volume?: number };

export type SessionVolumeRead = {
  /** The session the most recent bar belongs to. */
  session: SessionName;
  /** True when the instrument/feed published no usable volume. */
  unavailable: boolean;
  /** Median volume of the last N bars in this same session (excluding the current bar). */
  median: number;
  lastVolume: number;
  /** lastVolume / median. 1 = a normal bar for this session. */
  ratio: number;
  /** ratio < 0.5 — thin session conditions. */
  thin: boolean;
  /** Thin AND the current session is an overnight (Sydney/Tokyo) session. */
  overnightThin: boolean;
  /** Bars that fed the median. */
  bars: number;
  /** Human-readable read, e.g. "last bar traded 0.21x session median". */
  label: string;
};

const OVERNIGHT: SessionName[] = ["Sydney", "Tokyo"];

/**
 * One primary session per UTC hour. Overlaps are assigned to the session that
 * actually owns the liquidity in that hour, so each bar lands in exactly one
 * bucket and medians stay comparable.
 */
export function sessionForHour(utcHour: number): SessionName {
  const h = ((Math.floor(utcHour) % 24) + 24) % 24;
  if (h >= 21) return "Sydney";
  if (h < 7) return "Tokyo";
  if (h < 12) return "London";
  return "New York";
}

export function sessionOf(timeSeconds: number): SessionName {
  const ms = timeSeconds > 1e12 ? timeSeconds : timeSeconds * 1000;
  return sessionForHour(new Date(ms).getUTCHours());
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Median volume of the last `lookback` bars that share the current bar's
 * session, and where the current bar sits against it.
 */
export function readSessionVolume(candles: VolCandle[], lookback = 20): SessionVolumeRead | null {
  if (!candles.length) return null;
  const lastBar = candles[candles.length - 1]!;
  const session = sessionOf(lastBar.time);
  const lastVolume = Number(lastBar.volume ?? 0);

  const peers: number[] = [];
  for (let i = candles.length - 2; i >= 0 && peers.length < lookback; i--) {
    const c = candles[i]!;
    if (sessionOf(c.time) !== session) continue;
    const v = Number(c.volume ?? 0);
    if (v > 0) peers.push(v);
  }

  const med = median(peers);
  const unavailable = !(lastVolume > 0) || !(med > 0) || peers.length < 5;
  const ratio = unavailable ? 1 : lastVolume / med;
  const thin = !unavailable && ratio < 0.5;

  return {
    session,
    unavailable,
    median: med,
    lastVolume,
    ratio,
    thin,
    overnightThin: thin && OVERNIGHT.includes(session),
    bars: peers.length,
    label: unavailable
      ? `${session} session volume unavailable for this feed`
      : `${session} session: last bar traded ${ratio.toFixed(2)}x session median`,
  };
}

/** Stop distance in ATR multiples for the measured session conditions. */
export function sessionStopAtr(read: SessionVolumeRead | null, base = 0.6): number {
  if (!read || read.unavailable || !read.thin) return base;
  // Thin tape ⇒ wider noise band. 1.2x ATR at the 0.5x boundary, up to 1.5x as
  // volume dries up further.
  const extra = Math.min(0.3, Math.max(0, (0.5 - read.ratio) / 0.5) * 0.3);
  return Number((1.2 + extra).toFixed(2));
}

export type OrderBlockLike = {
  top: number;
  bot: number;
  kind: "bullish" | "bearish";
  mitigated: boolean;
  mitigations?: number;
};

export type MitigatedBlockRead = {
  /** The block the entry sits inside, if any. */
  inBlock: boolean;
  mitigated: boolean;
  mitigations: number;
  warning: string | null;
  /** Confidence points to subtract for repeat mitigation. */
  confidencePenalty: number;
};

/**
 * Is the planned entry sitting in an order block that price has already tested?
 * A mitigated block holds less often, and one that has been run through twice
 * or more is usually just a level on the way to somewhere else.
 */
export function readMitigatedEntry(
  entry: number,
  bias: "Long" | "Short" | "Neutral",
  blocks: OrderBlockLike[],
): MitigatedBlockRead {
  const none: MitigatedBlockRead = { inBlock: false, mitigated: false, mitigations: 0, warning: null, confidencePenalty: 0 };
  if (!Number.isFinite(entry) || bias === "Neutral" || !blocks.length) return none;
  const wanted = bias === "Long" ? "bullish" : "bearish";
  const hit = blocks
    .filter((b) => b.kind === wanted)
    .find((b) => entry >= Math.min(b.bot, b.top) && entry <= Math.max(b.bot, b.top));
  if (!hit) return none;
  const mitigations = Math.max(hit.mitigations ?? (hit.mitigated ? 1 : 0), hit.mitigated ? 1 : 0);
  if (!hit.mitigated || mitigations === 0) {
    return { inBlock: true, mitigated: false, mitigations: 0, warning: null, confidencePenalty: 0 };
  }
  const repeat = mitigations >= 2;
  return {
    inBlock: true,
    mitigated: true,
    mitigations,
    confidencePenalty: repeat ? 12 : 6,
    warning: repeat
      ? `Entry is in an order block that has already been mitigated ${mitigations} times - expect it to fail rather than hold. Skip it or take a fraction of normal size.`
      : "Entry is in a mitigated block - expect weaker hold, consider tighter size or skip.",
  };
}

/** Instrument families that need different session treatment. */
export type AssetClass = "crypto" | "index" | "fx-metal";

const CRYPTO_BASES = new Set([
  "BTC", "ETH", "XRP", "SOL", "DOGE", "ADA", "LTC", "BCH", "LINK", "AVAX",
  "DOT", "MATIC", "TRX", "XLM", "ATOM", "UNI", "ETC", "FIL", "NEAR", "APT",
  "ARB", "OP", "SUI", "TON", "SHIB", "PEPE", "PAXG", "BNB",
]);

const INDEX_SYMBOLS = new Set([
  "NAS100", "SPX500", "US30", "GER40", "UK100", "JPN225", "US2000", "HK50", "AUS200",
]);

/**
 * Which session rules apply to this symbol. Crypto trades round the clock, so a
 * quiet Tokyo hour is normal, not a reason to stand down. Indices care about the
 * cash open rather than London.
 */
export function assetClassFor(ticker: string): AssetClass {
  const t = (ticker ?? "").toUpperCase().replace(/\s+/g, "");
  if (INDEX_SYMBOLS.has(t)) return "index";
  const head = t.split("/")[0] ?? "";
  if (CRYPTO_BASES.has(head) || CRYPTO_BASES.has(head.replace(/(USD|USDT)$/, ""))) return "crypto";
  return "fx-metal";
}

/**
 * Thin overnight tape is a timing problem, not a broken setup: the structure and
 * the levels stand, they just should not be executed until real participation
 * arrives. Returns the window to wait for, or null when no gate applies.
 */
export function timingGateFor(
  ticker: string,
  read: SessionVolumeRead | null,
): { waitFor: string; message: string } | null {
  if (!read || read.unavailable || !read.overnightThin) return null;
  const cls = assetClassFor(ticker);
  // 24/7 market: an overnight session is just another session.
  if (cls === "crypto") return null;
  const waitFor = cls === "index" ? "the New York cash session" : "the London open";
  return {
    waitFor,
    message: cls === "index"
      // Futures trade nearly 24h - this is a thin-tape caution, not a closed market.
      ? `Timing note: futures are open, but ${read.label} (${read.bars}-bar median) is too thin to execute cleanly. The setup and its levels stand - participation usually arrives at ${waitFor}, so entries fill better then.`
      : `Timing gate: the setup and its levels stand, but ${read.label} (${read.bars}-bar median) is too little participation to execute. Wait for ${waitFor} before taking the entry.`,
  };
}
