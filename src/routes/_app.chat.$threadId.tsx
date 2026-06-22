import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { getClientId, readJournal, readActiveCoach } from "@/lib/chat-client";
import { getChatMessages } from "@/lib/chat.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/chat/$threadId")({
  component: ChatThread,
});

function ChatThread() {
  const { threadId } = useParams({ from: "/_app/chat/$threadId" });
  const [clientId, setClientId] = useState("");
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const getMsgs = useServerFn(getChatMessages);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setClientId(getClientId());
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setInitialMessages(null);
    getMsgs({ data: { clientId, threadId } })
      .then((rows) => setInitialMessages(rows as UIMessage[]))
      .catch((e) => {
        console.error(e);
        setInitialMessages([]);
      });
  }, [clientId, threadId, getMsgs]);

  if (!clientId || initialMessages === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading conversation...
      </div>
    );
  }

  return (
    <ChatThreadInner
      key={threadId}
      threadId={threadId}
      clientId={clientId}
      initialMessages={initialMessages}
      textareaRef={textareaRef}
    />
  );
}

function ChatThreadInner({
  threadId,
  clientId,
  initialMessages,
  textareaRef,
}: {
  threadId: string;
  clientId: string;
  initialMessages: UIMessage[];
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages, id }) => ({
        body: {
          messages,
          threadId: id,
          clientId,
          coach: readActiveCoach(),
          journal: readJournal(),
        },
      }),
    }),
    onError: (err) => {
      console.error(err);
      toast.error(err?.message || "AI request failed");
    },
  });

  const loading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!loading) textareaRef.current?.focus();
  }, [loading, textareaRef, threadId]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="px-4 md:px-8 py-6 max-w-3xl mx-auto w-full">
          {messages.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-12">
              Ask your coach anything. They can see your journal.
            </div>
          )}
          {messages.map((m) => {
            const text = m.parts
              .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
              .join("");
            return (
              <Message key={m.id} from={m.role}>
                {m.role === "assistant" ? (
                  <MessageResponse>{text}</MessageResponse>
                ) : (
                  <MessageContent>{text}</MessageContent>
                )}
              </Message>
            );
          })}
          {status === "submitted" && (
            <Message from="assistant">
              <Shimmer>Thinking...</Shimmer>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border bg-background/80 backdrop-blur p-3 md:p-4">
        <div className="max-w-3xl mx-auto w-full">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your trades, setups, weaknesses..."
              autoFocus
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={!input.trim() || loading} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
