import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Link } from "@tanstack/react-router";
import { MessageSquare, Sparkles, ExternalLink, Trash2 } from "lucide-react";
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
import { getOrCreateDashboardThread, getChatMessages } from "@/lib/chat.functions";
import { readJournal, readActiveCoach } from "@/lib/chat-client";
import { toast } from "sonner";

export type DashboardChatHandle = {
  scan: (prompt: string) => void;
};

export type ChartContext = {
  ticker: string;
  intervalLabel: string;
  enabledLevels: string;
};

type Props = { chart?: ChartContext };

export const DashboardChatPanel = forwardRef<DashboardChatHandle, Props>(function DashboardChatPanel({ chart }, ref) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const getThread = useServerFn(getOrCreateDashboardThread);
  const getMsgs = useServerFn(getChatMessages);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getThread();
        if (cancelled || !t) return;
        setThreadId(t.id);
        const rows = await getMsgs({ data: { threadId: t.id } });
        if (!cancelled) setInitial(rows as UIMessage[]);
      } catch (e) {
        console.error(e);
        if (!cancelled) setInitial([]);
      }
    })();
    return () => { cancelled = true; };
  }, [getThread, getMsgs]);

  if (!threadId || initial === null) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        Loading coach…
      </div>
    );
  }

  return <ChatInner ref={ref} threadId={threadId} initial={initial} chart={chart} />;
});


const ChatInner = forwardRef<DashboardChatHandle, { threadId: string; initial: UIMessage[]; chart?: ChartContext }>(
  function ChatInner({ threadId, initial, chart }, ref) {
    const [input, setInput] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const chartRef = useRef<ChartContext | undefined>(chart);
    useEffect(() => { chartRef.current = chart; }, [chart]);

    const { messages, sendMessage, status, setMessages } = useChat({
      id: threadId,
      messages: initial,
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
            chart: chartRef.current,
          },
        }),
      }),
      onError: (err) => {
        console.error(err);
        toast.error(err?.message || "AI request failed");
      },
    });

    const loading = status === "submitted" || status === "streaming";

    useImperativeHandle(ref, () => ({
      scan: (prompt: string) => {
        if (loading) return;
        void sendMessage({ text: prompt });
      },
    }), [sendMessage, loading]);

    const handleSubmit = () => {
      const text = input.trim();
      if (!text || loading) return;
      setInput("");
      void sendMessage({ text });
    };

    function clearChat() {
      if (!confirm("Clear this conversation? (it's just the dashboard scratchpad)")) return;
      setMessages([]);
    }

    return (
      <div className="flex flex-col h-full min-h-0 rounded-xl border border-border bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Coach
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearChat}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-md"
              title="Clear conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <Link
              to="/chat"
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-md"
              title="Open full chat"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <Conversation className="flex-1 min-h-0">
          <ConversationContent className="px-3 py-4">
            {messages.length === 0 && (
              <div className="text-center text-xs text-muted-foreground py-10 flex flex-col items-center gap-2">
                <MessageSquare className="h-5 w-5 opacity-60" />
                <div>Ask about a setup, or hit <span className="text-foreground font-medium">Run a scan</span> on the chart.</div>
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
                <Shimmer>Analyzing…</Shimmer>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t border-border bg-background/60 p-2">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your coach…"
              rows={2}
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={!input.trim() || loading} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    );
  },
);
