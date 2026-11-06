import { z } from "zod";

export const coachPlanSchema = z.object({
  symbol: z.string().trim().min(1).max(30),
  timeframe: z.string().max(20).optional(),
  side: z.enum(["long", "short"]),
  grade: z.enum(["A+", "A", "B", "C", "D"]),
  entry: z.number().positive().finite(),
  stop: z.number().positive().finite(),
  target: z.number().positive().finite(),
}).refine((p) => p.side === "long" ? p.stop < p.entry && p.target > p.entry : p.stop > p.entry && p.target < p.entry,
  "Stop and target must protect the specified direction.");

export function assertCoachAccount(expected: { broker: string; accountId: string; env: string }, actual: { broker: string; accountId: string | null; env: string }) {
  if (expected.broker !== actual.broker || expected.accountId !== actual.accountId || expected.env !== actual.env) {
    throw new Error("Your trading account changed. Review this action again before confirming.");
  }
}

export function assertCoachConfirmation(expiresAt: string, confirmed: boolean, live: boolean, acknowledgeLive: boolean, now = Date.now()) {
  if (!confirmed) throw new Error("Explicit confirmation is required.");
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) throw new Error("This action expired. Review it again.");
  if (live && !acknowledgeLive) throw new Error("Acknowledge the real-money account before confirming.");
}