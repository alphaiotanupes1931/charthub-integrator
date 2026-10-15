import { describe, it, expect } from "vitest";
import { evaluateTrackRecord } from "@/lib/scan-track-record.shared";

const rows = (n: number, r: number | null, status = "target") => Array.from({ length: n }, () => ({ status, realized_r: r }));
const opts = { otherCapBinding: false, label: "XAU/USD 1H short" };

describe("scan track record", () => {
  it("only shows history under 30 settled results", () => {
    const t = evaluateTrackRecord(rows(29, -1, "stop"), "B", opts);
    expect(t.action).toBe("show");
    expect(t.newGrade).toBe("B");
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
