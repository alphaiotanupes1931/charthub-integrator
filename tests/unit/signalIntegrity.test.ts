import { describe, expect, it } from "vitest";
import {
  fingerprintBackfill,
  signalFingerprint,
  verifyIntegrity,
  type IntegrityRow,
} from "@/lib/signal-integrity.server";

const base = {
  symbol: "XAUUSD",
  timeframe: "60",
  bias: "Long",
  grade: "A",
  entry: 2350.5,
  stop: 2344.25,
  tp1: 2365,
  createdAt: "2026-09-01T12:00:00.000Z",
};

describe("signal filing fingerprint", () => {
  it("is deterministic for identical terms", () => {
    expect(signalFingerprint(base)).toBe(signalFingerprint({ ...base }));
  });

  it("ignores casing and timestamp formatting", () => {
    expect(signalFingerprint({ ...base, symbol: "xauusd", bias: "long", grade: "a" })).toBe(
      signalFingerprint(base),
    );
    expect(signalFingerprint({ ...base, createdAt: "2026-09-01T12:00:00Z" })).toBe(signalFingerprint(base));
  });

  it("changes when any material term changes", () => {
    const original = signalFingerprint(base);
    expect(signalFingerprint({ ...base, stop: 2344.26 })).not.toBe(original);
    expect(signalFingerprint({ ...base, tp1: 2366 })).not.toBe(original);
    expect(signalFingerprint({ ...base, bias: "Short" })).not.toBe(original);
    expect(signalFingerprint({ ...base, grade: "A+" })).not.toBe(original);
    expect(signalFingerprint({ ...base, createdAt: "2026-09-01T13:00:00.000Z" })).not.toBe(original);
  });
});

describe("integrity verification", () => {
  const sealed: IntegrityRow = { ...base, id: "1", filedHash: signalFingerprint(base) };

  it("verifies untouched rows", () => {
    const report = verifyIntegrity([sealed]);
    expect(report.verified).toBe(1);
    expect(report.tampered).toHaveLength(0);
    expect(report.clean).toBe(true);
  });

  it("flags a row whose stop was moved after filing", () => {
    const moved: IntegrityRow = { ...sealed, id: "2", stop: 2340 };
    const report = verifyIntegrity([sealed, moved]);
    expect(report.tampered.map((t) => t.id)).toEqual(["2"]);
    expect(report.clean).toBe(false);
  });

  it("reports unsealed rows as unverifiable rather than verified", () => {
    const report = verifyIntegrity([{ ...base, id: "3", filedHash: null }]);
    expect(report.verified).toBe(0);
    expect(report.unverifiable).toBe(1);
    expect(report.clean).toBe(false);
  });

  it("only backfills rows with no seal", () => {
    const updates = fingerprintBackfill([sealed, { ...base, id: "4", filedHash: null }]);
    expect(updates.map((u) => u.id)).toEqual(["4"]);
    expect(updates[0].filed_hash).toBe(signalFingerprint(base));
  });
});
