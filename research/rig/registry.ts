// Trials registry. The harness writes every evaluated variant here itself,
// abandoned ones included, so the comparison count is a number, not a memory.
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";

const FILE = new URL("../registry/trials.jsonl", import.meta.url).pathname;

export type Prereg = { id: string; hypothesis: string; null: string; primaryOutcome: string; decisionEffectR: number; gate: string };
export type Trial = { runId: string; prereg: string; variant: string; split: "build" | "holdout" | "cost1.5" | "validation"; n: number; avgR: number; totalR: number; at: string; abandoned?: boolean };

export function register(kind: "prereg" | "trial" | "verdict", row: object) {
  mkdirSync(new URL("../registry/", import.meta.url).pathname, { recursive: true });
  appendFileSync(FILE, JSON.stringify({ kind, at: new Date().toISOString(), ...row }) + "\n");
}

export function readRegistry(): Array<Record<string, unknown>> {
  return existsSync(FILE) ? readFileSync(FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

/** Every variant ever evaluated counts toward the multiple-testing correction. */
export function comparisonCount(): number {
  return new Set(readRegistry().filter((r) => r.kind === "trial").map((r) => `${r.prereg}:${r.variant}`)).size;
}

/** The holdout may be opened once per pre-registration. */
export function holdoutOpened(prereg: string): boolean {
  return readRegistry().some((r) => r.kind === "trial" && r.prereg === prereg && r.split === "holdout");
}
