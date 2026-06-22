import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Link } from "@tanstack/react-router";
import { MessageSquare, Sparkles, ExternalLink, Trash2, X, Minus, Volume2, VolumeX, ChevronDown } from "lucide-react";
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
import { readJournal, readActiveCoach, writeActiveCoach, readActiveStrategy } from "@/lib/chat-client";
import { findStrategyByName } from "@/lib/customStrategies";
import { readActiveLensId, findLens } from "@/lib/scanLens";
import { useCoachVoice } from "@/hooks/useCoachVoice";
import { voiceForCoach, COACH_VOICES } from "@/lib/coachVoices";
import { toast } from "sonner";

export type DashboardChatHandle = {
  scan: (prompt: string) => void;
};

export type ChartContext = {
  ticker: string;
  intervalLabel: string;
  enabledLevels: string;
  snapshot?: import("@/components/NativeChart").ChartSnapshot;
};

type Props = { chart?: ChartContext; onClose?: () => void; onMinimize?: () => void };

export const DashboardChatPanel = forwardRef<DashboardChatHandle, Props>(function DashboardChatPanel({ chart, onClose, onMinimize }, ref) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const getThread = useServerFn(getOrCreateDashboardThread);
  const getMsgs = useServerFn(getChatMessages);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    const timeout = window.setTimeout(() => {
      if (!cancelled && (!threadId || initial === null)) {
        setLoadError("Couldn't reach the coach. Check your connection.");
      }
    }, 8000);
    (async () => {
      try {
        const t = await getThread();
        if (cancelled) return;
        if (!t) {
          setLoadError("Coach unavailable. Try again.");
          return;
        }
        setThreadId(t.id);
        const rows = await getMsgs({ data: { threadId: t.id } });
        if (!cancelled) setInitial(rows as UIMessage[]);
      } catch (e) {
        console.error("[coach] load failed", e);
        if (!cancelled) {
          // Render the panel anyway with no history so the user isn't blocked.
          setInitial([]);
          setLoadError("Coach history unavailable, starting fresh.");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { cancelled = true; window.clearTimeout(timeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getThread, getMsgs, attempt]);

  if (!threadId || initial === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center text-xs text-muted-foreground">
        <div>{loadError ?? "Loading coach…"}</div>
        {loadError && (
          <button
            onClick={() => { setThreadId(null); setInitial(null); setAttempt((n) => n + 1); }}
            className="rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return <ChatInner ref={ref} threadId={threadId} initial={initial} chart={chart} onClose={onClose} onMinimize={onMinimize} />;
});


const ChatInner = forwardRef<DashboardChatHandle, { threadId: string; initial: UIMessage[]; chart?: ChartContext; onClose?: () => void; onMinimize?: () => void }>(
  function ChatInner({ threadId, initial, chart, onClose, onMinimize }, ref) {

    const [input, setInput] = useState("");
    const [activeCoach, setActiveCoach] = useState<string>(() => readActiveCoach());
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const chartRef = useRef<ChartContext | undefined>(chart);
    useEffect(() => { chartRef.current = chart; }, [chart]);
    const voice = useCoachVoice();
    const lastSpokenIdRef = useRef<string | null>(null);

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
        prepareSendMessagesRequest: ({ messages, id }) => {
          const stratName = readActiveStrategy();
          const strategy = stratName ? findStrategyByName(stratName) ?? { name: stratName } : null;
          const lens = findLens(readActiveLensId());
          return {
            body: {
              messages,
              threadId: id,
              coach: readActiveCoach(),
              journal: readJournal(),
              chart: chartRef.current,
              strategy,
              lens: { id: lens.id, name: lens.name, promptEmphasis: lens.promptEmphasis },
            },
          };
        },
      }),
      onError: (err) => {
        console.error(err);
        toast.error(err?.message || "AI request failed");
      },
    });

    const loading = status === "submitted" || status === "streaming";

    // Speak the last assistant message after streaming completes
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


    useImperativeHandle(ref, () => ({
      scan: (prompt: string) => {
        if (loading) return;
        if (voice.enabled) voice.prime();
        void sendMessage({ text: prompt });
      },
    }), [sendMessage, loading, voice]);

    const handleSubmit = () => {
      const text = input.trim();
      if (!text || loading) return;
      if (voice.enabled) voice.prime();
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
          <div className="flex items-center gap-2 text-sm font-medium min-w-0">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span className="hidden sm:inline text-muted-foreground">AI Coach</span>
            <div className="relative">
              <select
                value={activeCoach}
                onChange={(e) => {
                  const name = e.target.value;
                  if (name === activeCoach) return;
                  if (voice.enabled) voice.stop();
                  writeActiveCoach(name);
                  setActiveCoach(name);
                  toast.success(`${name} is now your coach`);
                }}
                className="h-7 appearance-none rounded-md border border-border bg-background/60 pl-2 pr-6 text-xs font-semibold focus:outline-none focus:border-primary/50 cursor-pointer hover:border-primary/40"
                aria-label="Change coach voice"
              >
                {Object.keys(COACH_VOICES).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (voice.enabled) voice.stop();
                voice.setEnabled(!voice.enabled);
              }}
              className={`p-1.5 rounded-md ${voice.enabled ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              title={voice.enabled ? "Mute coach voice" : "Hear coach replies aloud"}
              aria-label={voice.enabled ? "Mute voice" : "Enable voice"}
            >
              {voice.enabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onMinimize}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-md"
              title="Hide coach (audio keeps playing)"
              aria-label="Hide coach"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              onClick={clearChat}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-md"
              title="Start a new conversation"
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
            {onClose && (
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground p-1.5 rounded-md"
                title="Close coach"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>


        </div>

        <Conversation className="flex-1 min-h-0">
          <ConversationContent className="px-3 py-4">
            {messages.length === 0 && (
              <EmptyStateSuggestions
                chart={chart}
                disabled={loading}
                onPick={(text) => void sendMessage({ text })}
              />
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

function EmptyStateSuggestions({
  chart,
  disabled,
  onPick,
}: {
  chart?: ChartContext;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const ticker = chart?.ticker ?? "XAU/USD";
  const tf = chart?.intervalLabel ?? "1H";
  const levels = chart?.enabledLevels || "VWAP, POC, S/R";
  const hasSnapshot = !!chart?.snapshot;
  const suggestions = [
    hasSnapshot
      ? `Scan my chart right now — ${ticker} ${tf}. Use the live price, VWAP, POC, and any liquidity/order-flow data you can see to tell me bias, entry, stop, TP1 and TP2.`
      : `Analyze ${ticker} for a trade setup. Give me entry, stop loss, and take profit levels.`,
    `What's my edge on ${ticker} based on my journal?`,
    `Walk me through a ${tf} ${ticker} plan using ${levels}.`,
    `What's my biggest weakness right now? Be specific with trade examples.`,
  ];
  return (
    <div className="py-6 px-1 flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <MessageSquare className="h-5 w-5 text-muted-foreground/70" />
        <div className="text-xs text-muted-foreground">
          Ask your coach, or tap a suggestion to get started.
        </div>
      </div>
      <div className="w-full flex flex-col gap-1.5 mt-1">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="text-left text-xs leading-snug rounded-lg border border-border/70 bg-background/40 hover:bg-primary/5 hover:border-primary/40 transition px-3 py-2 text-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

  },
);
