/**
 * Tiny CSV helper for admin tables: build a CSV string and trigger a download.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(",")).join("\n");
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const csv = toCsv(headers, rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function csvDate(): string {
  return new Date().toISOString().slice(0, 10);
}
