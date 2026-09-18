/**
 * Append-only integrity for filed signals.
 *
 * Every scan is filed with a fingerprint of the terms it was filed on: symbol,
 * timeframe, direction, grade, entry, stop, first target and the filing
 * timestamp. The fingerprint is stored alongside the row.
 *
 * Recomputing the fingerprint from the stored row and comparing it to the stored
 * value is the whole guarantee: if anyone edits an entry, moves a stop, widens a
 * target, flips a direction or upgrades a grade after the fact, the two stop
 * matching and the row is reported as tampered. Nothing is silently corrected —
 * a mismatch is evidence, not something to paper over.
 *
 * Rows filed before the fingerprint existed carry a null hash. Those are
 * reported as "unverifiable", never as "verified".
 */

import { createHash } from "node:crypto";

export type FingerprintInput = {
  symbol: string;
  timeframe: string;
  bias: string;
  grade: string;
  entry: number;
  stop: number;
  tp1: number;
  createdAt: string;
};

/** Prices are fingerprinted at a fixed precision so float formatting cannot shift the hash. */
function price(n: number): string {
  return Number(n).toFixed(8);
}

/**
 * Deterministic fingerprint of a filed signal. Same terms in, same hash out,
 * on any machine, in any order of fields.
 */
export function signalFingerprint(input: FingerprintInput): string {
  const payload = [
    "v1",
    input.symbol.trim().toUpperCase(),
    input.timeframe.trim(),
    input.bias.trim().toLowerCase(),
    input.grade.trim().toUpperCase(),
    price(input.entry),
    price(input.stop),
    price(input.tp1),
    new Date(input.createdAt).toISOString(),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export type IntegrityRow = FingerprintInput & { id: string; filedHash: string | null };

export type IntegrityReport = {
  checked: number;
  verified: number;
  /** Filed before fingerprinting existed: no claim can be made either way. */
  unverifiable: number;
  tampered: Array<{ id: string; symbol: string; storedHash: string; recomputed: string }>;
  /** True only when every checked row carries a hash and every hash matches. */
  clean: boolean;
  notes: string[];
};

/** Recompute every fingerprint and report, without writing anything. */
export function verifyIntegrity(rows: IntegrityRow[]): IntegrityReport {
  let verified = 0;
  let unverifiable = 0;
  const tampered: IntegrityReport["tampered"] = [];

  for (const row of rows) {
    if (!row.filedHash) {
      unverifiable += 1;
      continue;
    }
    const recomputed = signalFingerprint(row);
    if (recomputed === row.filedHash) verified += 1;
    else tampered.push({ id: row.id, symbol: row.symbol, storedHash: row.filedHash, recomputed });
  }

  const notes: string[] = [];
  if (unverifiable) {
    notes.push(
      `${unverifiable} row${unverifiable === 1 ? "" : "s"} filed before fingerprinting was added carry no hash. They are shown as unverifiable, not as verified.`,
    );
  }
  if (tampered.length) {
    notes.push(
      `${tampered.length} row${tampered.length === 1 ? "" : "s"} no longer match the terms they were filed on. Nothing was corrected automatically.`,
    );
  }
  if (!tampered.length && !unverifiable && rows.length) {
    notes.push("Every checked row still matches the terms it was filed on.");
  }

  return {
    checked: rows.length,
    verified,
    unverifiable,
    tampered,
    clean: tampered.length === 0 && unverifiable === 0 && rows.length > 0,
    notes,
  };
}

/** Backfill a fingerprint onto rows that predate the column. Never overwrites an existing hash. */
export function fingerprintBackfill(rows: IntegrityRow[]): Array<{ id: string; filed_hash: string }> {
  return rows
    .filter((r) => !r.filedHash)
    .map((r) => ({ id: r.id, filed_hash: signalFingerprint(r) }));
}
