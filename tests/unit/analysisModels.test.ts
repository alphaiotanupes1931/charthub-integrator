import { describe, expect, it } from "vitest";
import {
  ANALYSIS_MODELS,
  analysisModelPromptBlock,
  analysisModelReady,
  analysisModelVersion,
  getAnalysisModel,
  normalizeAnalysisModel,
} from "@/lib/analysis-models";
import { buildScoreboard, type SignalScoreRow } from "@/lib/signal-scores.shared";
import { douglasAnalysis, douglasContextBlock } from "@/lib/analysis-models/douglas-engine";

const row = (over: Partial<SignalScoreRow>): SignalScoreRow =>
  ({
    id: Math.random().toString(36).slice(2),
    symbol: "XAUUSD",
    timeframe: "1H",
    grade: "A",
    bias: "Long",
    confidence: null,
    strategyId: null,
    entry: 100,
    stop: 99,
    tp1: 102,
    plannedR: 2,
    status: "target",
    resultR: 2,
    taken: null,
    createdAt: new Date().toISOString(),
    counterTrend: false,
    htfBias: null,
    modelId: "classic",
    ...over,
  }) as SignalScoreRow;

describe("analysis model registry", () => {
  it("defaults anything unknown to Classic", () => {
    expect(normalizeAnalysisModel("focus")).toBe("focus");
    expect(normalizeAnalysisModel("classic")).toBe("classic");
    expect(normalizeAnalysisModel(undefined)).toBe("classic");
    expect(normalizeAnalysisModel("something-else")).toBe("classic");
  });

  it("stamps a distinct version per model", () => {
    expect(analysisModelVersion("classic")).toBe("classic-1.0");
    expect(analysisModelVersion("focus")).not.toBe(analysisModelVersion("classic"));
  });

  it("names model 2 The Trading Channel", () => {
    expect(getAnalysisModel("focus").name).toBe("The Trading Channel");
  });

  it("every model carries a full explanation behind the info button", () => {
    for (const m of ANALYSIS_MODELS) {
      expect(m.description.length).toBeGreaterThan(40);
    }
  });

  it("all models are ready once their rulebooks are written in", () => {
    expect(analysisModelReady("classic")).toBe(true);
    expect(analysisModelReady("focus")).toBe(true);
    expect(analysisModelReady("photon")).toBe(true);
    expect(analysisModelReady("douglas")).toBe(true);
    // The safety copy stays in place in case the rulebook is ever emptied.
    expect(getAnalysisModel("focus").notReadyReason).toBeTruthy();
    expect(getAnalysisModel("photon").notReadyReason).toBeTruthy();
  });

  it("The Trading Channel version tracks its rulebook version", () => {
    expect(analysisModelVersion("focus")).toContain("trading-channel-1.0");
  });

  it("names model 3 Photon Trading and tracks its rulebook version", () => {
    expect(getAnalysisModel("photon").name).toBe("Photon Trading");
    expect(analysisModelVersion("photon")).toContain("photon-1.0");
    expect(analysisModelVersion("photon")).not.toBe(analysisModelVersion("focus"));
    expect(normalizeAnalysisModel("photon")).toBe("photon");
  });

  it("Photon Trading carries its source link behind the info button", () => {
    const photon = getAnalysisModel("photon");
    expect(photon.sourceUrl).toBe("https://www.youtube.com/watch?v=Pd9ASRCHWmQ");
    expect(photon.sourceLabel).toBeTruthy();
  });

  it("The Trading Channel is fed only its own rulebook and inherits nothing from Classic", () => {
    const block = analysisModelPromptBlock("focus");
    expect(block).toContain("ONLY the strategies");
    expect(block.toLowerCase()).not.toContain("order block");
    // Classic's knowledge still lives in the chat prompt, so its block stays empty.
    expect(analysisModelPromptBlock("classic")).toBe("");
  });

  it("Photon Trading is fed only its own rulebook and inherits nothing from the other models", () => {
    const block = analysisModelPromptBlock("photon");
    expect(block).toContain("Photon Trading");
    expect(block).toContain("ONLY the strategies");
    expect(block).toContain("photon-1.0");
    expect(block.toLowerCase()).not.toContain("order block");
    expect(block).not.toContain("38.2 candle");
  });

  it("names model 4 Mark Douglas and tracks its rulebook version", () => {
    const douglas = getAnalysisModel("douglas");
    expect(douglas.name).toBe("Mark Douglas");
    expect(analysisModelVersion("douglas")).toContain("douglas-1.0");
    expect(analysisModelVersion("douglas")).not.toBe(analysisModelVersion("photon"));
    expect(normalizeAnalysisModel("douglas")).toBe("douglas");
    expect(douglas.sourceLabel).toBeTruthy();
  });

  it("Mark Douglas is fed only psychology and files no signals of its own", () => {
    const block = analysisModelPromptBlock("douglas");
    expect(block).toContain("Mark Douglas");
    expect(block).toContain("douglas-1.0");
    expect(block.toLowerCase()).toContain("no trade signals");
    expect(block.toLowerCase()).not.toContain("order block");
    expect(block).not.toContain("38.2 candle");
    // The description must be honest about the no-signal scope.
    expect(getAnalysisModel("douglas").description.toLowerCase()).toContain("files no trade signals");
  });

  it("the Douglas engine always grades NO ENTRY and never invents levels", () => {
    const read = douglasAnalysis();
    expect(read.grade).toBe("NO ENTRY");
    expect(read.bias).toBe("Neutral");
    expect(read.rulebookVersion).toBe("douglas-1.0");
    expect(read.checklist.length).toBeGreaterThanOrEqual(5);
    const block = douglasContextBlock(read, "XAUUSD", "1H");
    expect(block).toContain("MARK DOUGLAS MODEL");
    expect(block).toContain("files no signals");
    // Deterministic: same call, same read.
    expect(douglasAnalysis()).toEqual(read);
  });

  it("every registered model has a name and version", () => {
    for (const m of ANALYSIS_MODELS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.version.length).toBeGreaterThan(0);
    }
  });
});

describe("scoreboard model split", () => {
  it("never pools two models into one figure", () => {
    const board = buildScoreboard([
      row({ modelId: "classic", status: "target", resultR: 2 }),
      row({ modelId: "classic", status: "stop", resultR: -1 }),
      row({ modelId: "focus", status: "target", resultR: 2 }),
    ]);
    const classic = board.byModel.find((b) => b.key === "classic");
    const focus = board.byModel.find((b) => b.key === "focus");
    expect(classic?.decided).toBe(2);
    expect(focus?.decided).toBe(1);
    expect(board.byModelGrade.some((b) => b.key === "focus A")).toBe(true);
  });

  it("treats a legacy row with no model as Classic", () => {
    const board = buildScoreboard([row({ modelId: null })]);
    expect(board.byModel[0]?.key).toBe("classic");
  });
});
