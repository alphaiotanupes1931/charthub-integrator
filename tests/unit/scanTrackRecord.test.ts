import { describe, it, expect } from "vitest";
import { evaluateTrackRecord } from "@/lib/scan-track-record.shared";

const rows = (n: number, r: number | null, status = "target") => Array.from({ length: n }, () => ({ status, realized_r: r }));
const opts = { otherCapBinding: false, label: "XAU/USD 1H short" };

describe("scan track record", () => {
  it("only shows losing history under 30 settled results", () => {
    const t = evaluateTrackRecord(rows(29, -1, "stop"), "B", opts);
    expect(t.action).toBe("show");
    expect(t.newGrade).toBe("B");
  });
  it("needs 15 settled results before anything moves", () => {
    expect(evaluateTrackRecord(rows(14, 1.5), "C", opts).newGrade).toBe("C");
  });
  it("lifts a C to B early at 15 results with 0.4R+ and 60%+ wins", () => {
    expect(evaluateTrackRecord(rows(15, 1.5), "C", opts).newGrade).toBe("B");
    const mixed = [...rows(8, 1.5), ...rows(7, -1, "stop")]; // 53% wins
    expect(evaluateTrackRecord(mixed, "C", opts).newGrade).toBe("C");
    expect(evaluateTrackRecord(rows(15, 1.5), "C", { ...opts, otherCapBinding: true }).newGrade).toBe("C");
  });
  it("a proven 0.5R+ record at 30 results lifts past a binding cap", () => {
    expect(evaluateTrackRecord(rows(30, 1), "C", { ...opts, otherCapBinding: true }).newGrade).toBe("B");
  });
  it("drops a losing setup one grade at 30 results and halves size", () => {
    const t = evaluateTrackRecord(rows(30, -1, "stop"), "B", opts);
    expect(t).toMatchObject({ action: "down", newGrade: "C", halfSize: true });
  });
  it("never blocks: a C stays C", () => {
    expect(evaluateTrackRecord(rows(30, -1, "stop"), "C", opts).newGrade).toBe("C");
  });
  it("raises a winning setup one grade when no other rule holds it down", () => {
    expect(evaluateTrackRecord(rows(30, 1), "C", opts).newGrade).toBe("B");
    expect(evaluateTrackRecord(rows(30, 1), "C", { ...opts, otherCapBinding: true }).newGrade).toBe("C");
  });
  it("counts unfilled calls as 0R and ignores open ones", () => {
    const t = evaluateTrackRecord([...rows(30, null, "unfilled"), ...rows(5, -1, "open")], "B", opts);
    expect(t).toMatchObject({ n: 30, avgR: 0, newGrade: "B" });
  });
});
