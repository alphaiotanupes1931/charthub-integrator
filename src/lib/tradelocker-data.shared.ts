export type TLColumn = { id: string };
export type TLPanel = { columns?: TLColumn[] };
export function tlRecord(columns: TLColumn[] | undefined, row: unknown): Record<string, unknown> {
  if (!Array.isArray(row) || !columns?.length) return {};
  return Object.fromEntries(columns.map((column, index) => [column.id, row[index]]));
}
export function tlNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}