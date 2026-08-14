import { useEffect, useState } from "react";
import { findLoggedTrade, onLoggedTradesChange, type LoggedTradeMark } from "@/lib/loggedTrades";
import { readLastThreadId } from "@/lib/chat-client";

/**
 * Tells a signal card whether this exact setup has already been saved into the
 * journal, so it can say "Already logged" instead of offering the button again.
 * When no thread is passed it falls back to the chat the trader is in.
 */
export function useTradeLogged(input: { symbol?: string | null; threadId?: string | null; entry?: number | null }) {
  const { symbol, threadId, entry } = input;
  const [mark, setMark] = useState<LoggedTradeMark | null>(null);

  useEffect(() => {
    if (!symbol) {
      setMark(null);
      return;
    }
    const refresh = () =>
      setMark(findLoggedTrade({ symbol, threadId: threadId ?? readLastThreadId(), entry }));
    refresh();
    return onLoggedTradesChange(refresh);
  }, [symbol, threadId, entry]);

  return mark;
}
