import { describe, it, expect } from "vitest";
import { recommend, pickType, answersFromProblem } from "@/lib/trader-profile/score";

describe("trader type tie-breaks", () => {
  it("comeback beats stop mover on a tie", () => {
    expect(pickType({ after_loss: "revenge", stop: "move", experience: "2to5y" })).toBe("comeback");
  });
  it("stop mover beats gut on a tie", () => {
    expect(pickType({ stop: "move", entry: "feel", experience: "2to5y" })).toBe("stop_mover");
  });
  it("gut beats second-guesser on a tie", () => {
    expect(pickType({ entry: "signal", leak: "skip", experience: "2to5y" })).toBe("gut");
  });
  it("second-guesser beats overtrader on a tie", () => {
    expect(pickType({ leak: "early", time: "most", entry: "checklist", experience: "2to5y" })).toBe("second_guesser");
  });
  it("new trader with no strong leak gets the guided path", () => {
    expect(pickType({ experience: "lt6m", stop: "never" })).toBe("new_trader");
  });
  it("new trader with a revenge habit stays comeback", () => {
    expect(pickType({ experience: "lt6m", after_loss: "revenge" })).toBe("comeback");
  });
});

describe("recommendations", () => {
  it("comeback trader gets the Disciplinarian and cautious risk", () => {
    const r = recommend({ after_loss: "bigger", experience: "2to5y" });
    expect(r.coach).toBe("The Disciplinarian");
    expect(r.risk).toEqual({ riskPct: 0.5, maxDailyLossPct: 2, minGrade: "A" });
  });
  it("calm experienced trader gets standard risk", () => {
    const r = recommend({ stop: "move", experience: "5y", feel: "calm", anxiety: "3" });
    expect(r.risk).toEqual({ riskPct: 1, maxDailyLossPct: 3, minGrade: "B+" });
  });
  it("anxiety 7 or more goes to the Psychologist", () => {
    expect(recommend({ entry: "checklist", rules: "exact", anxiety: "7", experience: "5y" }).coach).toBe("The Psychologist");
  });
  it("metals traders only get the metals-safe playbooks", () => {
    expect(recommend({ market: "metals", hold: "minutes", experience: "5y", stop: "move" }).strategies)
      .toEqual(["Breakout & Retest", "Supply & Demand Zones"]);
  });
  it("new traders get Breakout & Retest only and the Mentor", () => {
    const r = recommend({ experience: "lt6m" });
    expect(r.strategies).toEqual(["Breakout & Retest"]);
    expect(r.coach).toBe("The Mentor");
  });
  it("feedback answer sets coach tone", () => {
    expect(recommend({ feedback: "straight" }).tone).toBe("straight");
  });
  it("first week has five days", () => {
    expect(recommend({ stop: "none", experience: "5y" }).week).toHaveLength(5);
  });
  it("'I overtrade' self-select maps to the Overtrader and Minimalist", () => {
    const r = recommend(answersFromProblem("overtrade", { market: "forex", hold: "minutes", experience: "2to5y" }));
    expect(r.type).toBe("overtrader");
    expect(r.coach).toBe("The Minimalist");
  });
});
