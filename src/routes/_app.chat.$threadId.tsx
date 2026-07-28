import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Volume2, VolumeX } from "lucide-react";
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
import { readJournal, readActiveCoach } from "@/lib/chat-client";
import { getChatMessages, getActiveModel, type ActiveModelInfo } from "@/lib/chat.functions";
import { useCoachVoice } from "@/hooks/useCoachVoice";
import { voiceForCoach } from "@/lib/coachVoices";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/chat/$threadId")({
  component: ChatThread,
});

function ChatThread() {
  const { threadId } = useParams({ from: "/_app/chat/$threadId" });
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const getMsgs = useServerFn(getChatMessages);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setInitialMessages(null);
    getMsgs({ data: { threadId } })
      .then((rows) => setInitialMessages(rows as UIMessage[]))
      .catch((e) => {
        console.error(e);
        setInitialMessages([]);
      });
  }, [threadId, getMsgs]);

  if (initialMessages === null) {
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
      initialMessages={initialMessages}
      textareaRef={textareaRef}
    />
  );
}

function ChatThreadInner({
  threadId,
  initialMessages,
  textareaRef,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const [input, setInput] = useState("");
  const voice = useCoachVoice();
  const lastSpokenIdRef = useRef<string | null>(null);
  const [activeModel, setActiveModel] = useState<ActiveModelInfo | null>(null);
  const getModel = useServerFn(getActiveModel);
  useEffect(() => {
    getModel().then(setActiveModel).catch(() => setActiveModel(null));
  }, [getModel]);

  const { messages, sendMessage, status } = useChat({
    id: threadId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (input, init) => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const headers = new Headers(init?.headers);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
      prepareSendMessagesRequest: ({ messages, id }) => ({
        body: {
          messages,
          threadId: id,
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
    if (!voice.enabled) return;
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (lastSpokenIdRef.current === last.id) return;
    const text = last.parts
      .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
      .join("")
      .trim();
    if (!text) return;
    lastSpokenIdRef.current = last.id;
    void voice.speak(text, voiceForCoach(readActiveCoach()));
  }, [messages, status, voice]);

  useEffect(() => {
    if (!loading) textareaRef.current?.focus();
  }, [loading, textareaRef, threadId]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || loading) return;
    if (voice.enabled) voice.prime();
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 md:px-8 py-2 max-w-3xl mx-auto w-full border-b border-border/60 bg-background/80">
        <span className="text-sm font-semibold text-foreground">{readActiveCoach()}</span>
        <span className="text-[9px] font-semibold uppercase tracking-wider text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
          {activeModel?.label ?? "AI"}
        </span>
      </div>
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
              <button
                type="button"
                onClick={() => {
                  const next = !voice.enabled;
                  voice.setEnabled(next);
                  if (next) voice.resumeAudio(); else voice.pauseAudio();
                }}
                className={`h-9 w-9 inline-flex items-center justify-center rounded-md transition ${voice.enabled ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
                title={voice.enabled ? "Mute coach voice" : "Hear coach replies aloud"}
                aria-label={voice.enabled ? "Mute voice" : "Enable voice"}
              >
                {voice.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <PromptInputSubmit status={status} disabled={!input.trim() || loading} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
