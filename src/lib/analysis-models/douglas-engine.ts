// Mark Douglas engine — deterministic core for Model 4.
//
// The Douglas material is pure trading psychology: it contains no entry
// mechanics, so this engine is deliberately NOT a chart scanner. It never
// fabricates direction, entry, stop, target, or grade — it returns a fixed
// execution-discipline read and always grades NO ENTRY, which means the
// model files no signals and accumulates no scoreboard record. That is the
// honest scope of the material, and it is stated in the model's description.
//
// Fully deterministic and pure: same call, same read, every time.

import { DOUGLAS_RULEBOOK, DOUGLAS_RULEBOOK_VERSION } from "./douglas-rulebook";

export type DouglasRead = {
  rulebookVersion: string;
  grade: "NO ENTRY";
  bias: "Neutral";
  /** The pre-trade discipline checklist the model exists to enforce. */
  checklist: string[];
  note: string;
};

/** The fixed execution-discipline checklist, in Douglas's terms. */
export const DOUGLAS_CHECKLIST: readonly string[] = [
  "Is this setup produced by your method — not by how the last trade felt?",
  "Is the risk predefined before entry, as the price of finding out whether the edge works this time?",
  "Are you willing to take the small loss without moving the stop or arguing with it?",
  "Will you take EVERY signal this edge produces, knowing the sequence of wins and losses is unknowable?",
  "Are you free of euphoria (nothing can go wrong) and fear (this one must work)?",
  "Are you executing mechanically — no analysing or judging the signal mid-trade?",
];

export function douglasAnalysis(): DouglasRead {
  return {
    rulebookVersion: DOUGLAS_RULEBOOK_VERSION,
    grade: "NO ENTRY",
    bias: "Neutral",
    checklist: [...DOUGLAS_CHECKLIST],
    note:
      "This is the Mark Douglas mindset model. It is fed trading psychology only and files no trade signals of its own — Douglas's own teaching is that the METHOD supplies the edge and the MIND supplies the consistency. Run your chart model (Classic, The Trading Channel, or Photon Trading) for the setup; use this model to coach its execution. Before taking any trade your chart model produces, work the checklist: every answer must be yes.",
  };
}

export function douglasContextBlock(read: DouglasRead, ticker: string, interval: string): string {
  const items = read.checklist.map((c, i) => `  ${i + 1}. ${c}`);
  const rules = DOUGLAS_RULEBOOK.map((r) => `  Rule ${r.id} ${r.title}`).join("\n");
  return [
    `MARK DOUGLAS MODEL — MINDSET READ (${read.rulebookVersion}) for ${ticker} on ${interval}.`,
    "This model is fed ONLY the Mark Douglas trading-psychology material. It has no chart mechanics by design: it files no signals, and you must not invent a direction, entry, stop, target, or grade for it.",
    `Grade: ${read.grade}. Bias: ${read.bias}.`,
    "Pre-trade discipline checklist (every answer must be yes before executing any setup from a chart model):",
    ...items,
    "Coaching rules available:",
    rules,
    read.note,
  ].join("\n");
}
