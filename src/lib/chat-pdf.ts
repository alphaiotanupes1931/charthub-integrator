// Export an AI chat conversation as a PDF the trader can keep or share.
// Everything runs in the browser: no upload, no server cost.
import type { UIMessage } from "ai";
import { textFromUiMessageParts } from "@/lib/chat-stream";
import { parseAiPayload } from "@/lib/chartAnnotations";

export type ChatPdfOptions = {
  coach?: string;
  instrument?: string | null;
  filename?: string;
  /** Heading printed at the top of page one. */
  title?: string;
};

function num(n?: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5);
}

type Line = { text: string; bold?: boolean; muted?: boolean; size?: number };

/** Flatten chat messages into printable lines. */
export function chatToLines(messages: UIMessage[], opts: ChatPdfOptions = {}): Line[] {
  const lines: Line[] = [];
  for (const m of messages) {
    const raw = textFromUiMessageParts(m.parts);
    if (!raw.trim()) continue;

    if (m.role !== "assistant") {
      // Scan prompts carry an internal marker; print the trader-facing line.
      const display = raw.match(/^<<<SCAN_DISPLAY:([^>]*)>>>/);
      lines.push({ text: "You", bold: true, size: 10 });
      lines.push({ text: display ? (display[1] ?? "") : raw });
      lines.push({ text: "" });
      continue;
    }

    const parsed = parseAiPayload(raw);
    lines.push({ text: opts.coach ? opts.coach : "Coach", bold: true, size: 10 });
    const g = parsed.grade;
    if (g) {
      lines.push({
        text: `Setup: ${String(g.bias ?? "neutral").toUpperCase()}  Grade ${String(g.grade ?? "").toUpperCase()}  Entry ${num(g.entry)}  Stop ${num(g.stop)}  TP1 ${num(g.tp1)}  TP2 ${num(g.tp2)}`,
        muted: true,
        size: 10,
      });
      if (g.strength) lines.push({ text: `Why take it: ${g.strength}`, muted: true, size: 10 });
      if (g.weakness && g.weakness !== g.strength) lines.push({ text: `Risk: ${g.weakness}`, muted: true, size: 10 });
    }
    lines.push({ text: (parsed.cleanText || raw).replace(/\*\*/g, "") });
    lines.push({ text: "" });
  }
  return lines;
}

export async function downloadChatPdf(messages: UIMessage[], opts: ChatPdfOptions = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 48;
  const marginTop = 56;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - marginX * 2;
  let y = marginTop;

  const write = (text: string, size: number, bold: boolean, muted: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(muted ? 110 : 20);
    const wrapped = doc.splitTextToSize(text, maxW) as string[];
    for (const row of wrapped) {
      if (y > pageH - 56) {
        doc.addPage();
        y = marginTop;
      }
      doc.text(row, marginX, y);
      y += size * 1.42;
    }
  };

  write(opts.title ?? "TradeMind AI coaching conversation", 16, true, false);
  const stampParts = [
    new Date().toLocaleString(),
    opts.coach ? `Coach: ${opts.coach}` : "",
    opts.instrument ? `Instrument: ${opts.instrument}` : "",
  ].filter(Boolean);
  write(stampParts.join("   |   "), 9, false, true);
  y += 8;

  const lines = chatToLines(messages, opts);
  if (!lines.length) write("This conversation is empty.", 11, false, true);
  for (const line of lines) {
    if (!line.text) {
      y += 8;
      continue;
    }
    write(line.text, line.size ?? 11, !!line.bold, !!line.muted);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(opts.filename ?? `trademind-chat-${stamp}.pdf`);
}
