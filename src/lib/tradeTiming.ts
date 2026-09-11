/**
 * Trade timing and R-multiple management, computed from the plan itself.
 *
 * Pure module (no browser or server APIs beyond Intl/Date) so the same numbers
 * are used by the Analysis cards, the chat scan text, and the journal.
 *
 * Timing is anchored to New York session clock because that is how the killzones
 * are defined, then rendered in whatever timezone the user has selected.
 */

export type AssetClass = "crypto" | "fx" | "metal" | "energy" | "index" | "equity";
export type TradeStyle = "scalp" | "intraday" | "swing";

export type TradeTiming = {
  assetClass: AssetClass;
  /** Recommended holding style. Traders may override this before scanning. */
  tradeStyle: TradeStyle;
  /** Session the entry window belongs to. */
  session: string;
  /** Whether the entry window is open right now. */
  live: boolean;
  /** ISO timestamps. */
  enterFrom: string;
  enterUntil: string;
  /** Cancel the working order if it has not filled by this time. */
  cancelIfUnfilled: string;
  /** Flatten / stop managing by this time regardless of outcome. */
  exitBy: string;
  /** Human hold-time expectation, e.g. "4 to 8 hours". */
  holdTime: string;
  /** R multiples of the plan's own targets. */
  tp1R: number;
  tp2R: number;
  /** Prices at fixed R multiples, for scaling rules. */
  r1: number;
  r2: number;
  /** One-line management recommendation. */
  ratioAdvice: string;
  /** Ordered scale-out rules. */
  scale: Array<{ label: string; price: number; action: string }>;
};

type Input = {
  symbol?: string;
  /** TradingView-style interval: 1, 5, 15, 60, 240, D, W, M. */
  interval?: string;
  bias?: "long" | "short" | "neutral" | "Long" | "Short" | "Neutral";
  entry?: number;
  stop?: number;
  tp1?: number;
  tp2?: number;
  now?: Date;
  /** Optional trader override; Auto leaves this undefined. */
  tradeStyle?: TradeStyle;
  /** Current volatility as ATR percent of price. */
  atrPct?: number;
  /** Whether the Daily/4H/1H cascade is aligned. */
  aligned?: boolean;
};

export function classifyAsset(symbol?: string): AssetClass {
  const s = (symbol ?? "").toUpperCase();
  if (/BTC|ETH|SOL|XRP|DOGE|CRYPTO/.test(s)) return "crypto";
  if (/XAU|XAG|GOLD|SILVER|PLAT/.test(s)) return "metal";
  if (/OIL|WTI|BRENT|NGAS|USOIL/.test(s)) return "energy";
  if (/NAS|US30|SPX|SP500|NDX|GSPC|DJI|US100|US500|GER|UK100|JP225/.test(s)) return "index";
  if (/[A-Z]{3}[\/_]?[A-Z]{3}/.test(s)) return "fx";
  return "equity";
}

/** Hour (with minutes as a fraction) in New York time for a given instant. */
function nyHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (h % 24) + m / 60;
}

/** Shift an instant by hours. */
function plusHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}

type Window = { name: string; start: number; end: number };

function killzonesFor(cls: AssetClass): Window[] {
  if (cls === "crypto") {
    return [
      { name: "Asia session", start: 20, end: 24 },
      { name: "London killzone", start: 2, end: 5 },
      { name: "New York killzone", start: 8, end: 11.5 },
    ];
  }
  if (cls === "index") {
    // Index futures (NAS100, US30, SPX500) trade nearly around the clock -
    // Sunday 6 PM ET through Friday 5 PM ET, with only a short daily break.
    // They are NOT closed outside the cash session, so every session window
    // is a valid entry window; the cash open is still the highest-volume one.
    return [
      { name: "Asia session", start: 20, end: 24 },
      { name: "London killzone", start: 3, end: 5 },
      { name: "New York open drive", start: 9.5, end: 11.5 },
      { name: "New York afternoon", start: 13.5, end: 15.5 },
    ];
  }
  if (cls === "equity") {
    // Single stocks only trade the cash session.
    return [
      { name: "New York open drive", start: 9.5, end: 11.5 },
      { name: "New York afternoon", start: 13.5, end: 15.5 },
    ];
  }
  if (cls === "energy") {
    return [
      { name: "London killzone", start: 3, end: 6 },
      { name: "New York killzone", start: 9, end: 12 },
    ];
  }
  // FX and metals
  return [
    { name: "London killzone", start: 2, end: 5 },
    { name: "New York killzone", start: 8, end: 11 },
    { name: "London close", start: 10, end: 12 },
  ];
}

export function classifyTradeStyle(input: Pick<Input, "interval" | "atrPct" | "aligned" | "tradeStyle">): TradeStyle {
  if (input.tradeStyle) return input.tradeStyle;
  const n = Number(input.interval);
  if (!Number.isFinite(n) || n >= 240) return "swing";
  if (n <= 5 || ((input.atrPct ?? 0) >= 0.8 && n <= 15)) return "scalp";
  if (n <= 60) return "intraday";
  return input.aligned ? "swing" : "intraday";
}

function holdFor(interval: string | undefined, style: TradeStyle): { hours: number; label: string } {
  if (style === "scalp") return { hours: 2, label: "15 minutes to 2 hours" };
  if (style === "swing") return { hours: 24 * 5, label: "1 to 5 days" };
  switch (interval) {
    case "1":
    case "3":
      return { hours: 1, label: "15 to 60 minutes" };
    case "5":
      return { hours: 2, label: "30 minutes to 2 hours" };
    case "15":
      return { hours: 4, label: "1 to 4 hours" };
    case "30":
      return { hours: 6, label: "2 to 6 hours" };
    case "240":
      return { hours: 72, label: "1 to 3 days" };
    case "D":
      return { hours: 24 * 10, label: "3 to 10 days" };
    case "W":
    case "M":
      return { hours: 24 * 30, label: "2 to 6 weeks" };
    default:
      return { hours: 8, label: "2 to 8 hours" };
  }
}

function round(n: number): number {
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
  return Number(n.toFixed(d));
}

export function computeTiming(input: Input): TradeTiming | null {
  const { symbol, interval, entry, stop, tp1, tp2 } = input;
  const biasRaw = String(input.bias ?? "").toLowerCase();
  if (biasRaw !== "long" && biasRaw !== "short") return null;
  if (![entry, stop].every((n) => typeof n === "number" && isFinite(n as number) && (n as number) > 0)) return null;

  const now = input.now ?? new Date();
  const cls = classifyAsset(symbol);
  const zones = killzonesFor(cls);
  const h = nyHour(now);

  // Find the window we are inside, otherwise the next one to open.
  const inside = zones.find((z) => h >= z.start && h < z.end);
  let session: string;
  let enterFrom: Date;
  let enterUntil: Date;
  if (inside) {
    session = inside.name;
    enterFrom = now;
    enterUntil = plusHours(now, inside.end - h);
  } else {
    const upcoming = zones
      .map((z) => ({ z, wait: z.start > h ? z.start - h : 24 - h + z.start }))
      .sort((a, b) => a.wait - b.wait)[0]!;
    session = upcoming.z.name;
    enterFrom = plusHours(now, upcoming.wait);
    enterUntil = plusHours(enterFrom, upcoming.z.end - upcoming.z.start);
  }

  const tradeStyle = classifyTradeStyle(input);
  const hold = holdFor(interval, tradeStyle);
  const cancelIfUnfilled = enterUntil;
  const exitBy = plusHours(enterUntil, hold.hours);

  const long = biasRaw === "long";
  const risk = Math.abs((entry as number) - (stop as number)) || 1;
  const dir = long ? 1 : -1;
  const r1 = round((entry as number) + dir * risk);
  const r2 = round((entry as number) + dir * risk * 2);
  const tp1R = typeof tp1 === "number" && isFinite(tp1) ? Math.abs(tp1 - (entry as number)) / risk : 0;
  const tp2R = typeof tp2 === "number" && isFinite(tp2) ? Math.abs(tp2 - (entry as number)) / risk : 0;

  const best = Math.max(tp1R, tp2R);
  const ratioAdvice =
    best >= 3
      ? "This one pays enough to run: bank half at 2:1 and trail the rest toward 3:1."
      : best >= 2
        ? "Take the 2:1. Scale half at 1:1, move the stop to break even, let the rest reach 2:1."
        : best >= 1.4
          ? "This is a 1.5:1 trade at best. Take the full position off at TP1 rather than holding for more."
          : "Reward is under 1.5:1, so treat it as a 1:1 scalp or skip it - the maths does not pay for the risk.";

  const scale: TradeTiming["scale"] = [
    { label: "1:1", price: r1, action: "Bank 50% and move the stop to break even" },
    ...(tp1R >= 1.4 && typeof tp1 === "number"
      ? [{ label: `TP1 (${tp1R.toFixed(1)}R)`, price: round(tp1), action: "Take 25% and trail the runner" }]
      : []),
    ...(best >= 2
      ? [{ label: "2:1", price: r2, action: "Close the remainder unless momentum is still expanding" }]
      : []),
    ...(tp2R >= 2.8 && typeof tp2 === "number"
      ? [{ label: `TP2 (${tp2R.toFixed(1)}R)`, price: round(tp2), action: "Final exit - flatten here" }]
      : []),
  ];

  return {
    assetClass: cls,
    tradeStyle,
    session,
    live: Boolean(inside),
    enterFrom: enterFrom.toISOString(),
    enterUntil: enterUntil.toISOString(),
    cancelIfUnfilled: cancelIfUnfilled.toISOString(),
    exitBy: exitBy.toISOString(),
    holdTime: hold.label,
    tp1R: Number(tp1R.toFixed(2)),
    tp2R: Number(tp2R.toFixed(2)),
    r1,
    r2,
    ratioAdvice,
    scale,
  };
}

/** Short clock label, e.g. "Fri 9:30 AM ET". */
export function clockLabel(iso: string, tz?: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString(undefined, {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Abbreviation for the active timezone, e.g. "EDT" or "GMT+2". */
export function tzAbbrev(tz?: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** The timezone the device is currently set to. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
