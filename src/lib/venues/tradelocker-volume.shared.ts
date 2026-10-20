// Converts a unit-based position size into TradeLocker lots that respect the
// broker's contract size, minimum, maximum and step for that instrument.
export type TLVolumeRules = {
  contractSize: number | null; // units per 1 lot
  minLots: number | null;
  maxLots: number | null;
  stepLots: number | null;
};

export type TLVolumeResult =
  | { ok: true; lots: number; capped: boolean }
  | { ok: false; reason: string };

const KEYS = {
  contractSize: ["lotsize", "contractsize", "contractmultiplier"],
  minLots: ["minordersize", "minqty", "minvolume", "minlot", "minlots", "minimumordersize"],
  maxLots: ["maxordersize", "maxqty", "maxvolume", "maxlot", "maxlots", "maximumordersize"],
  stepLots: ["lotstep", "qtystep", "volumestep", "ordersizestep", "stepsize"],
} as const;

/** Read volume rules from TradeLocker objects, matching keys case-insensitively. */
export function pickVolumeRules(sources: Record<string, unknown>[]): TLVolumeRules {
  const find = (names: readonly string[]): number | null => {
    for (const src of sources) {
      for (const [k, v] of Object.entries(src ?? {})) {
        if (!names.includes(k.toLowerCase())) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  };
  return {
    contractSize: find(KEYS.contractSize),
    minLots: find(KEYS.minLots),
    maxLots: find(KEYS.maxLots),
    stepLots: find(KEYS.stepLots),
  };
}

/** Standard CFD contract sizes (units per lot) when the broker doesn't say. */
export function standardContractSize(symbol: string, brokerName = ""): number {
  const s = `${symbol} ${brokerName}`.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  if (/XAG|SILVER/.test(s)) return 5000;
  if (/XAU|GOLD/.test(s)) return 100;
  if (/XPT|XPD|PLATINUM|PALLADIUM/.test(s)) return 100;
  if (/WTI|USOIL|UKOIL|BRENT|XTI|XBR/.test(s)) return 1000;
  if (/NATGAS|XNG/.test(s)) return 10000;
  const compact = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const fx = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD"];
  if (compact.length === 6 && fx.includes(compact.slice(0, 3)) && fx.includes(compact.slice(3))) return 100000;
  return 1; // indices and crypto trade 1 unit per lot on most TradeLocker brokers
}

export function unitsToTradeLockerLots(units: number, rules: TLVolumeRules): TLVolumeResult {
  if (!Number.isFinite(units) || units <= 0) return { ok: false, reason: "The trade size is zero." };
  const contract = rules.contractSize && rules.contractSize > 0 ? rules.contractSize : 1;
  let lots = units / contract;
  let capped = false;
  if (rules.maxLots && rules.maxLots > 0 && lots > rules.maxLots) {
    lots = rules.maxLots;
    capped = true;
  }
  const step = rules.stepLots && rules.stepLots > 0 ? rules.stepLots : 0.01;
  lots = Math.floor(lots / step + 1e-9) * step;
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step))));
  lots = Number(lots.toFixed(decimals));
  const min = rules.minLots && rules.minLots > 0 ? rules.minLots : step;
  if (lots < min) {
    return {
      ok: false,
      reason: `This size is below the broker's minimum of ${min} lot${min === 1 ? "" : "s"}. Raise your risk per trade or skip this one.`,
    };
  }
  return { ok: true, lots, capped };
}
