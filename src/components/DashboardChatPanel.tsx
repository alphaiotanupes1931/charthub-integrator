import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
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
  attach: (file: File, prompt: string) => void;
  stop: () => void;
};

export type ChartContext = {
  ticker: string;
  intervalLabel: string;
  enabledLevels: string;
  snapshot?: import("@/components/NativeChart").ChartSnapshot;
};

type Props = { chart?: ChartContext; onClose?: () => void; onMinimize?: () => void };

const DASHBOARD_THREAD_FALLBACK_ID = "dashboard-scans";

export const DashboardChatPanel = forwardRef<DashboardChatHandle, Props>(function DashboardChatPanel({ chart, onClose, onMinimize }, ref) {
  const [threadId, setThreadId] = useState(DASHBOARD_THREAD_FALLBACK_ID);
  const [initial, setInitial] = useState<UIMessage[]>([]);
  const getThread = useServerFn(getOrCreateDashboardThread);
  const getMsgs = useServerFn(getChatMessages);

  // Wait for a real Supabase session before calling auth-protected server fns.
  // On mobile (slow cold start, app resumed from background) the token can take
  // a few seconds; we resolve immediately via onAuthStateChange when it arrives.
  const waitForSession = useCallback(async (): Promise<string | null> => {
    const immediate = await supabase.auth.getSession();
    if (immediate.data.session?.access_token) return immediate.data.session.access_token;

    return new Promise((resolve) => {
      let done = false;
      const finish = (token: string | null) => {
        if (done) return;
        done = true;
        sub?.data.subscription.unsubscribe();
        clearInterval(poll);
        clearTimeout(deadline);
        resolve(token);
      };
      const sub = supabase.auth.onAuthStateChange((_e, session) => {
        if (session?.access_token) finish(session.access_token);
      });
      const poll = setInterval(async () => {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) finish(data.session.access_token);
      }, 400);
      const deadline = setTimeout(() => finish(null), 15_000);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tryOnce = async () => {
      const t = await getThread();
      if (!t) throw new Error("no thread returned");
      if (cancelled) return null;
      const rows = await getMsgs({ data: { threadId: t.id } });
      return { threadId: t.id, rows: rows as UIMessage[] };
    };

    (async () => {
      const token = await waitForSession();
      if (cancelled) return;
      if (!token) {
        console.warn("[coach] session not ready; using live chat fallback");
        return;
      }

      // Three attempts with backoff: handles worker cold starts and flaky mobile networks.
      const delays = [0, 800, 2200];
      let lastErr: unknown = null;
      for (let i = 0; i < delays.length; i++) {
        if (cancelled) return;
        if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
        try {
          const loaded = await tryOnce();
          if (!cancelled && loaded) {
            setThreadId(loaded.threadId);
            setInitial(loaded.rows);
          }
          return;
        } catch (e) {
          lastErr = e;
          console.warn(`[coach] load attempt ${i + 1} failed`, e);
          // Refresh in case the token expired mid-flight.
          try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
        }
      }
      console.error("[coach] all attempts failed", lastErr);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getThread, getMsgs, waitForSession]);

  return <ChatInner key={threadId} ref={ref} threadId={threadId} initial={initial} chart={chart} onClose={onClose} onMinimize={onMinimize} />;
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

    const { messages, sendMessage, status, setMessages, stop } = useChat({
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
        const msg = err?.message?.trim() || "";
        // Suppress the AI SDK's generic stream-end error; surface only real, actionable errors.
        const generic = /^an error occurred\.?$/i.test(msg);
        if (msg && !generic) toast.error(msg);
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
      <div className="flex flex-col h-full min-h-0 bg-card overflow-hidden sm:rounded-xl border-y sm:border border-border shadow-2xl sm:shadow-xl">
        {/* Header */}
        <div
          className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 bg-card/95 backdrop-blur"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary shrink-0">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">AI Coach</span>
              <div className="flex items-center gap-1 -ml-1">
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
                    className="appearance-none bg-transparent pl-1 pr-5 text-sm font-semibold text-foreground focus:outline-none cursor-pointer max-w-full truncate"
                    aria-label="Change coach"
                  >
                    {Object.keys(COACH_VOICES).map((key) => (
                      <option key={key} value={key}>{key}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => {
                if (voice.enabled) voice.stop();
                voice.setEnabled(!voice.enabled);
              }}
              className={`h-9 w-9 inline-flex items-center justify-center rounded-md transition ${voice.enabled ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
              title={voice.enabled ? "Mute coach voice" : "Hear coach replies aloud"}
              aria-label={voice.enabled ? "Mute voice" : "Enable voice"}
            >
              {voice.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              onClick={clearChat}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
              title="Clear conversation"
              aria-label="Clear conversation"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <Link
              to="/chat"
              className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
              title="Open full chat"
              aria-label="Open full chat"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
            <button
              onClick={onMinimize}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
              title="Hide coach (keeps audio playing)"
              aria-label="Hide coach"
            >
              <Minus className="h-4 w-4" />
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60"
                title="Close coach"
                aria-label="Close coach"
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
                onPick={(text) => {
                  if (voice.enabled) voice.prime();
                  void sendMessage({ text });
                }}
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

        <div
          className="border-t border-border bg-background/80 backdrop-blur p-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
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
      ? `Scan my chart right now - ${ticker} ${tf}. Use the live price, VWAP, POC, and any liquidity/order-flow data you can see to tell me bias, entry, stop, TP1 and TP2.`
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
