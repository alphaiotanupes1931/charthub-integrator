import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageSquare } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { supabase } from "@/integrations/supabase/client";
import { textFromUiMessageParts } from "@/lib/chat-stream";
import { toast } from "sonner";

type Props = {
  /** The session read currently on screen, so questions have the same context. */
  writeup?: string | null;
  watchlist?: string[];
};

const SUGGESTIONS = [
  "Explain today's biggest release in simple terms",
  "What does this session read mean for my watchlist?",
  "Should I be flat into the next high impact print?",
];

/** Ask questions about the calendar and the session read without leaving the page. */
export function NewsChatPanel({ writeup, watchlist = [] }: Props) {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, stop } = useChat({
    id: "news-desk",
    transport: new DefaultChatTransport({
      api: "/api/news-chat",
      fetch: async (url, init) => {
        let { data } = await supabase.auth.getSession();
        let token = data.session?.access_token;
        const expiresAt = data.session?.expires_at ?? 0;
        if (!token || expiresAt * 1000 < Date.now() + 30_000) {
          try {
            const { data: refreshed } = await supabase.auth.refreshSession();
            token = refreshed.session?.access_token ?? token;
          } catch { /* ignore */ }
        }
        const headers = new Headers(init?.headers);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(url, { ...init, headers });
      },
      prepareSendMessagesRequest: ({ messages: msgs }) => ({
        body: { messages: msgs, writeup: writeup ?? null, watchlist },
      }),
    }),
    onError: (err) => toast.error(err.message || "The news desk could not answer that. Try again."),
  });

  const busy = status === "submitted" || status === "streaming";

  const ask = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    void sendMessage({ text: t });
  };

  return (
    <section className="border border-border/60 bg-card/40">
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <MessageSquare className="size-4 text-muted-foreground" />
        <h2 className="font-semibold">Ask about the news</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          Uses today's calendar and the session read above
        </span>
      </header>

      <div className="max-h-[420px] min-h-[180px] overflow-hidden">
        <Conversation className="h-full">
          <ConversationContent className="space-y-3 p-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Ask anything about the releases on this page, what a number means, or how it should
                  change your risk today.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                const text = textFromUiMessageParts(m.parts);
                if (!text) return null;
                return (
                  <Message key={m.id} from={m.role === "user" ? "user" : "assistant"}>
                    <MessageContent>
                      <MessageResponse>{text}</MessageResponse>
                    </MessageContent>
                  </Message>
                );
              })
            )}
            {status === "submitted" ? <Shimmer>Reading the calendar...</Shimmer> : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      <div className="border-t border-border/60 p-3">
        <PromptInput
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <PromptInputTextarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a release, a forecast, or what it means for your instruments"
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} disabled={!input.trim() && !busy} onClick={busy ? () => stop() : undefined} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
  );
}
