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
import { readJournal, readActiveCoach, readActiveStrategy, readLastChart, writeLastThreadId, type LastChart } from "@/lib/chat-client";
import { findStrategyByName } from "@/lib/customStrategies";
import { findLens, readActiveLensId } from "@/lib/scanLens";
import { getChatMessages, getActiveModel, type ActiveModelInfo } from "@/lib/chat.functions";
import { useCoachVoice } from "@/hooks/useCoachVoice";
import { voiceForCoach } from "@/lib/coachVoices";
import { coalesceUiMessageStream, textFromUiMessageParts } from "@/lib/chat-stream";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { buildLearningPromptBlock } from "@/lib/signalLearning";
import { parseAiPayload, type ChartGrade } from "@/lib/chartAnnotations";


export const Route = createFileRoute("/_app/chat/$threadId")({
  component: ChatThread,
});

function uiMessageText(message: UIMessage | null | undefined): string {
  return textFromUiMessageParts(message?.parts);
}

function num(n?: number) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  const abs = Math.abs(n);
  return n.toFixed(abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5);
}

/** Compact setup card so saved threads show the analysis, not just the text. */
function ThreadGradeCard({ grade }: { grade: ChartGrade }) {
  const bias = (grade.bias ?? "neutral").toString();
  const tone = bias === "long" ? "text-bull" : bias === "short" ? "text-red-300" : "text-muted-foreground";
  const rows: Array<[string, number | undefined]> = [
    ["Entry", grade.entry],
    ["Stop", grade.stop],
    ["TP1", grade.tp1],
    ["TP2", grade.tp2],
  ];
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 w-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60">
        <span className={`text-[10px] font-bold tracking-tight ${tone}`}>{bias}</span>
        <span className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] font-bold">
          {grade.grade.toUpperCase()}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded border border-border/50 bg-background/40 px-2 py-1">
            <div className="text-[9px] tracking-tight text-muted-foreground">{label}</div>
            <div className="font-mono text-[11px] text-foreground">{num(value)}</div>
          </div>
        ))}
      </div>
      {(grade.strength || grade.weakness) && (
        <div className="border-t border-border/50 px-3 py-2 space-y-1 text-xs">
          {grade.strength && (
            <div><span className="font-semibold text-bull">Why take this trade: </span><span className="text-foreground/90">{grade.strength}</span></div>
          )}
          {grade.weakness && grade.weakness !== grade.strength && (
            <div><span className="font-semibold text-red-400">Risk and invalidation: </span><span className="text-foreground/90">{grade.weakness}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

function ChatThread() {
  const { threadId } = useParams({ from: "/_app/chat/$threadId" });
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const getMsgs = useServerFn(getChatMessages);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    writeLastThreadId(threadId);
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

  // Coach switches must show up immediately in this header and on the next reply.
  const [activeCoach, setActiveCoach] = useState<string>(() => readActiveCoach());
  useEffect(() => {
    const sync = () => setActiveCoach(readActiveCoach());
    sync();
    window.addEventListener("trademind:coach", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("trademind:coach", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);
  const lastSentCoachRef = useRef<string | null>(null);


  // Live snapshot of instrument + strategy so the header always reflects context.
  const [ctx, setCtx] = useState<{ chart: LastChart | null; strategy: string | null }>(() => ({
    chart: readLastChart(),
    strategy: readActiveStrategy(),
  }));
  useEffect(() => {
    const sync = () => setCtx({ chart: readLastChart(), strategy: readActiveStrategy() });
    sync();
    const onStorage = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    const iv = window.setInterval(sync, 4000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
      window.clearInterval(iv);
    };
  }, [threadId]);

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
        return coalesceUiMessageStream(await fetch(input, { ...init, headers }));
      },
      prepareSendMessagesRequest: ({ messages, id }) => {
        const stratName = readActiveStrategy();
        const strategy = stratName ? findStrategyByName(stratName) ?? { name: stratName } : null;
        const lens = findLens(readActiveLensId());
        const lastChart = readLastChart();
        const coach = readActiveCoach();
        const previousCoach = lastSentCoachRef.current;
        lastSentCoachRef.current = coach;
        return {
          body: {
            messages,
            threadId: id,
            coach,
            previousCoach,
            journal: readJournal(),
            chart: lastChart ?? undefined,
            strategy,
            lens: { id: lens.id, name: lens.name, promptEmphasis: lens.promptEmphasis },
            signalLearning: buildLearningPromptBlock(),
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

  useEffect(() => {
    if (!voice.enabled) return;
    if (status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    if (lastSpokenIdRef.current === last.id) return;
    const text = uiMessageText(last).trim();
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
      <div className="flex items-center justify-between gap-3 px-4 md:px-8 py-2 max-w-3xl mx-auto w-full border-b border-border/60 bg-background/80">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">{readActiveCoach()}</span>
          {ctx.chart?.ticker && (
            <span className="text-[10px] font-semibold tracking-tight text-foreground px-1.5 py-0.5 rounded bg-muted border border-border/60 truncate max-w-[180px]" title={`${ctx.chart.ticker} · ${ctx.chart.intervalLabel}`}>
              {ctx.chart.ticker} · {ctx.chart.intervalLabel}
            </span>
          )}
          {ctx.strategy && (
            <span className="text-[10px] font-semibold tracking-tight text-muted-foreground px-1.5 py-0.5 rounded border border-border/60 truncate max-w-[160px]" title={`Strategy: ${ctx.strategy}`}>
              {ctx.strategy}
            </span>
          )}
        </div>
        <span className="text-[9px] font-semibold tracking-tight text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20 shrink-0">
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
            const text = uiMessageText(m);
            if (m.role !== "assistant") {
              return (
                <Message key={m.id} from={m.role}>
                  <MessageContent>{text}</MessageContent>
                </Message>
              );
            }
            // Saved threads store the raw reply, including the analysis block,
            // so reopening old history shows the setup card again, not just text.
            const parsed = parseAiPayload(text);
            return (
              <Message key={m.id} from={m.role}>
                <div className="flex flex-col gap-2 w-full">
                  {parsed.grade && <ThreadGradeCard grade={parsed.grade} />}
                  <MessageResponse>{parsed.cleanText || text}</MessageResponse>
                </div>
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

      <div className="border-t border-border/60 bg-background/80 backdrop-blur p-3 md:p-4">
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
                className={`h-9 w-9 inline-flex items-center justify-center rounded-xl transition ${voice.enabled ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
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
