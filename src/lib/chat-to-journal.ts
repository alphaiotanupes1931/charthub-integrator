// Stage a coaching conversation so the trade journal can attach it to a trade.
// Kept in localStorage for the hop between the dashboard and /journal; the
// journal then stores the text on the trade itself, which syncs to the cloud.
import type { UIMessage } from "ai";
import { chatToLines } from "@/lib/chat-pdf";

export const PENDING_CHAT_LOG_KEY = "tm_pending_chat_log";

export type PendingChatLog = { text: string; instrument?: string | null; coach?: string; savedAt: number };

/** Flatten the conversation to plain text and park it for the journal. */
export function stageChatForJournal(
  messages: UIMessage[],
  opts: { coach?: string; instrument?: string | null } = {},
): boolean {
  const text = chatToLines(messages, opts)
    .map((l) => l.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20000);
  if (!text) return false;
  const payload: PendingChatLog = { text, instrument: opts.instrument ?? null, coach: opts.coach, savedAt: Date.now() };
  try {
    localStorage.setItem(PENDING_CHAT_LOG_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** Read and clear the staged conversation. */
export function takePendingChatLog(): PendingChatLog | null {
  try {
    const raw = localStorage.getItem(PENDING_CHAT_LOG_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_CHAT_LOG_KEY);
    const parsed = JSON.parse(raw) as PendingChatLog;
    return parsed?.text ? parsed : null;
  } catch {
    return null;
  }
}
