// When the deterministic bias/structure engine replaced model-decided bias.
//
// Scans filed before this moment came out of the old pipeline (model-inferred
// direction, R-multiple targets), so mixing them into one hit-rate number hides
// whether the fix worked. Every published stat is shown twice: all time, and
// since this timestamp.
export const ENGINE_FIX_AT = "2026-09-04T00:00:00.000Z";

export const ENGINE_FIX_LABEL = "since the Sep 4 engine fix";

export function isAfterEngineFix(createdAt: string | number | Date): boolean {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= new Date(ENGINE_FIX_AT).getTime();
}
