import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Link } from "@tanstack/react-router";
import { MessageSquare, ExternalLink, Trash2, X, Minus, Volume2, VolumeX, Crosshair, Square, Paperclip, ImageIcon } from "lucide-react";
import { COACH_ICON_META, DEFAULT_COACH_ICON } from "@/lib/coachMeta";
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
import { voiceForCoach } from "@/lib/coachVoices";
import { useProfile } from "@/hooks/useProfile";
import { compressImage, getScreenshotQuota, bumpScreenshotQuota } from "@/lib/imageCompress";
import { toast } from "sonner";
import { parseAiPayload, type ChartAnnotation, type ChartGrade, type ConceptRef } from "@/lib/chartAnnotations";
import { ConceptDiagram } from "@/components/ConceptDiagram";

export type DashboardChatHandle = {
  scan: (prompt: string) => void;
  attach: (file: File, prompt: string) => void;
  ensureScanReply: (text: string) => void;
  stop: () => void;
};

export type ChartContext = {
  ticker: string;
  intervalLabel: string;
  enabledLevels: string;
  snapshot?: import("@/components/NativeChart").ChartSnapshot;
};

type Props = { chart?: ChartContext; onClose?: () => void; onMinimize?: () => void; onRunScan?: () => void; onStopScan?: () => void; scanning?: boolean; threadIdOverride?: string | null; onAnnotations?: (a: ChartAnnotation[]) => void; onConcept?: (c: ConceptRef | null) => void; onGrade?: (g: import("@/lib/chartAnnotations").ChartGrade | null) => void; };

const DASHBOARD_THREAD_FALLBACK_ID = "dashboard-scans";

export const DashboardChatPanel = forwardRef<DashboardChatHandle, Props>(function DashboardChatPanel({ chart, onClose, onMinimize, onRunScan, onStopScan, scanning, threadIdOverride, onAnnotations, onConcept, onGrade }, ref) {
  const [threadId, setThreadId] = useState<string | null>(threadIdOverride ?? null);
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const innerRef = useRef<DashboardChatHandle | null>(null);
  const pendingRef = useRef<Array<{ type: "scan"; prompt: string } | { type: "attach"; file: File; prompt: string } | { type: "ensureScanReply"; text: string }>>([]);
  const getThread = useServerFn(getOrCreateDashboardThread);
  const getMsgs = useServerFn(getChatMessages);

  const flushPending = useCallback(() => {
    const inner = innerRef.current;
    if (!inner || pendingRef.current.length === 0) return;
    const pending = pendingRef.current.splice(0);
    pending.forEach((item) => {
      if (item.type === "scan") inner.scan(item.prompt);
      else if (item.type === "attach") inner.attach(item.file, item.prompt);
      else inner.ensureScanReply(item.text);
    });
  }, []);

  useImperativeHandle(ref, () => ({
    scan: (prompt: string) => {
      if (innerRef.current) innerRef.current.scan(prompt);
      else pendingRef.current.push({ type: "scan", prompt });
    },
    attach: (file: File, prompt: string) => {
      if (innerRef.current) innerRef.current.attach(file, prompt);
      else pendingRef.current.push({ type: "attach", file, prompt });
    },
    ensureScanReply: (text: string) => {
      if (innerRef.current) innerRef.current.ensureScanReply(text);
      else pendingRef.current.push({ type: "ensureScanReply", text });
    },
    stop: () => {
      pendingRef.current = [];
      innerRef.current?.stop();
    },
  }), []);

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
    setInitial(null);
    setThreadId(threadIdOverride ?? null);

    (async () => {
      const token = await waitForSession();
      if (cancelled) return;
      if (!token) {
        setThreadId(DASHBOARD_THREAD_FALLBACK_ID);
        setInitial([]);
        return;
      }

      // If a specific thread was requested, just load its messages.
      if (threadIdOverride) {
        try {
          const rows = await getMsgs({ data: { threadId: threadIdOverride } });
          if (!cancelled) {
            setThreadId(threadIdOverride);
            setInitial(rows as UIMessage[]);
          }
        } catch (e) {
          console.warn("[chat] load thread failed", e);
        }
        return;
      }

      // Default: get-or-create the dashboard scratch thread with retry.
      const delays = [0, 800, 2200];
      for (let i = 0; i < delays.length; i++) {
        if (cancelled) return;
        if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
        try {
          const t = await getThread();
          if (!t) throw new Error("no thread returned");
          const rows = await getMsgs({ data: { threadId: t.id } });
          if (!cancelled) {
            setThreadId(t.id);
            setInitial(rows as UIMessage[]);
          }
          return;
        } catch (e) {
          console.warn(`[chat] load attempt ${i + 1} failed`, e);
          try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getThread, getMsgs, waitForSession, threadIdOverride]);

  useEffect(() => {
    if (!threadId || initial === null) return;
    const id = window.setTimeout(flushPending, 0);
    return () => window.clearTimeout(id);
  }, [threadId, initial, flushPending]);

  if (!threadId || initial === null) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-card text-xs text-muted-foreground sm:rounded-xl border-y sm:border border-border">
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        Loading chat history…
      </div>
    );
  }

  return <ChatInner key={threadId} ref={innerRef} threadId={threadId} initial={initial} chart={chart} onClose={onClose} onMinimize={onMinimize} onRunScan={onRunScan} onStopScan={onStopScan} scanning={scanning} onAnnotations={onAnnotations} onConcept={onConcept} onGrade={onGrade} />;
});


function GradeCard({ grade }: { grade: ChartGrade }) {
  const g = grade.grade.toUpperCase();
  const tone = g.startsWith("A") ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
    : g.startsWith("B") ? "text-lime-300 border-lime-500/40 bg-lime-500/10"
    : g.startsWith("C") ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
    : g.startsWith("D") ? "text-orange-300 border-orange-500/40 bg-orange-500/10"
    : "text-red-300 border-red-500/40 bg-red-500/10";
  const biasTone = grade.bias === "long" ? "text-emerald-300"
    : grade.bias === "short" ? "text-red-300"
    : "text-muted-foreground";
  const fmt = (n?: number) => (typeof n === "number" && isFinite(n) ? n.toString() : "-");
  return (
    <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
      <div className={`flex items-center justify-between px-3 py-2 border-b border-border/60 ${tone.split(" ").filter((c) => c.startsWith("bg-")).join(" ")}`}>
        <div className="flex items-baseline gap-2">
          <span className={`text-lg font-bold leading-none ${tone.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`}>{g}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Grade</span>
        </div>
        {grade.bias && (
          <span className={`text-xs font-semibold uppercase ${biasTone}`}>{grade.bias}</span>
        )}
      </div>
      <div className="grid grid-cols-4 divide-x divide-border/60 text-center">
        {(["entry","stop","tp1","tp2"] as const).map((k) => (
          <div key={k} className="p-2">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="text-xs font-mono text-foreground">{fmt(grade[k])}</div>
          </div>
        ))}
      </div>
      {(grade.strength || grade.weakness) && (
        <div className="p-2 space-y-1 text-xs border-t border-border/60">
          {grade.strength && (
            <div><span className="text-emerald-400 font-semibold">Strength: </span><span className="text-foreground/90">{grade.strength}</span></div>
          )}
          {grade.weakness && (
            <div><span className="text-red-400 font-semibold">Weakness: </span><span className="text-foreground/90">{grade.weakness}</span></div>
          )}
        </div>
      )}
    </div>
  );
}


const ChatInner = forwardRef<DashboardChatHandle, { threadId: string; initial: UIMessage[]; chart?: ChartContext; onClose?: () => void; onMinimize?: () => void; onRunScan?: () => void; onStopScan?: () => void; scanning?: boolean; onAnnotations?: (a: ChartAnnotation[]) => void; onConcept?: (c: ConceptRef | null) => void; onGrade?: (g: import("@/lib/chartAnnotations").ChartGrade | null) => void }>(
  function ChatInner({ threadId, initial, chart, onClose, onMinimize, onRunScan, onStopScan, scanning, onAnnotations, onConcept, onGrade }, ref) {

    const [input, setInput] = useState("");
    const [pendingImage, setPendingImage] = useState<{ url: string; name: string; mediaType: string } | null>(null);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [activeCoach, setActiveCoach] = useState<string>(() => readActiveCoach());
    const coachMeta = COACH_ICON_META[activeCoach] ?? DEFAULT_COACH_ICON;
    const CoachIcon = coachMeta.icon;
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const chartRef = useRef<ChartContext | undefined>(chart);
    useEffect(() => { chartRef.current = chart; }, [chart]);
    const voice = useCoachVoice();
    const { isAdmin } = useProfile();
    // Voice defaults to muted per-message; the user must tap the speaker to unmute.
    const [voiceUnmutedIds, setVoiceUnmutedIds] = useState<Set<string>>(() => new Set());
    const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

    const checkAndReserveQuota = useCallback((): boolean => {
      if (isAdmin) return true;
      const q = getScreenshotQuota();
      if (q.remaining <= 0) {
        toast.error(`Daily screenshot limit reached (${q.limit}/day). Try again tomorrow.`);
        return false;
      }
      return true;
    }, [isAdmin]);

    const ingestFile = useCallback(async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("Only image files can be attached");
        return;
      }
      if (!checkAndReserveQuota()) return;
      try {
        const { dataUrl, name, mediaType } = await compressImage(file);
        setPendingImage({ url: dataUrl, name, mediaType });
      } catch (e) {
        console.error(e);
        toast.error("Could not read that image");
      }
    }, [checkAndReserveQuota]);

    const { messages, sendMessage, status, setMessages, stop } = useChat({
      id: threadId,
      messages: initial,
      transport: new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          let { data } = await supabase.auth.getSession();
          let token = data.session?.access_token;
          // Refresh if missing/near-expiry so scans don't fail with "Unauthorized".
          const expiresAt = data.session?.expires_at ?? 0;
          if (!token || expiresAt * 1000 < Date.now() + 30_000) {
            try {
              const { data: refreshed } = await supabase.auth.refreshSession();
              token = refreshed.session?.access_token ?? token;
            } catch { /* ignore */ }
          }
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
        // Suppress generic stream-end errors and transient auth blips.
        const suppress = /^(an error occurred\.?|unauthorized|forbidden)$/i.test(msg);
        if (msg && !suppress) toast.error(msg);
      },
    });

    const messagesRef = useRef(messages);
    const statusRef = useRef(status);
    const lastScanAssistantCountRef = useRef<number | null>(null);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => { statusRef.current = status; }, [status]);

    const assistantCount = useCallback(() => messagesRef.current.filter((m) => m.role === "assistant").length, []);

    const hasVisibleAssistantReplySince = useCallback((before: number) => {
      const assistantMessages = messagesRef.current.filter((m) => m.role === "assistant").slice(before);
      return assistantMessages.some((m) => {
        const raw = m.parts
          .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
          .join("");
        const parsed = parseAiPayload(raw);
        return !!parsed.cleanText || !!parsed.grade || !!parsed.concept || parsed.annotations.length > 0;
      });
    }, []);

    const appendAssistantMessage = useCallback((text: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: [{ type: "text", text }],
        } as UIMessage,
      ]);
    }, [setMessages]);

    const chatBusy = status === "submitted" || status === "streaming";
    const loading = scanning || chatBusy;
    const stopScan = () => {
      voice.stop();
      try { stop(); } catch { /* ignore */ }
      onStopScan?.();
    };

    // Voice no longer auto-plays on reply completion. It now only plays when
    // the user expands the "Details" toggle on a specific message.
    // See the onToggle handler on the <details> element below.


    // Parse latest assistant message for chart annotations / concept / grade
    // and push to parent (dashboard) so the native chart can render them.
    useEffect(() => {
      const last = [...messages].reverse().find((m) => m.role === "assistant");
      if (!last) return;
      const text = last.parts.map((p) => (p.type === "text" ? (p as { text: string }).text : "")).join("");
      const parsed = parseAiPayload(text);
      if (onAnnotations) onAnnotations(parsed.annotations);
      if (onConcept) onConcept(parsed.concept ?? null);
      if (onGrade && parsed.grade) onGrade(parsed.grade);
    }, [messages, onAnnotations, onConcept, onGrade]);




    useImperativeHandle(ref, () => ({
      scan: (prompt: string) => {
        // If a prior stream is still running, stop it so the new scan goes through.
        if (chatBusy) { try { stop(); } catch { /* ignore */ } }
        lastScanAssistantCountRef.current = assistantCount();
        if (voice.enabled) voice.prime();
        void sendMessage({ text: prompt });
      },
      attach: async (file: File, prompt: string) => {
        if (!checkAndReserveQuota()) return;
        // If a prior scan is still streaming, stop it so the new screenshot goes through.
        if (chatBusy) { try { stop(); } catch { /* ignore */ } }
        if (voice.enabled) voice.prime();
        try {
          const { dataUrl, name, mediaType } = await compressImage(file);
          if (!isAdmin) bumpScreenshotQuota();
          void sendMessage({
            text: prompt,
            files: [{ type: "file", mediaType, url: dataUrl, filename: name }],
          });
          toast.success("Screenshot sent for scan");
        } catch (e) {
          console.error(e);
          toast.error("Could not attach that screenshot");
        }
      },
      stop: () => {
        try { stop(); } catch { /* ignore */ }
      },
      ensureScanReply: (text: string) => {
        const before = lastScanAssistantCountRef.current;
        if (before === null || hasVisibleAssistantReplySince(before)) return;
        const startedAt = Date.now();
        const addIfStillMissing = () => {
          if (before !== lastScanAssistantCountRef.current) return;
          if (hasVisibleAssistantReplySince(before)) return;
          if ((statusRef.current === "submitted" || statusRef.current === "streaming") && Date.now() - startedAt < 20_000) {
            window.setTimeout(addIfStillMissing, 1000);
            return;
          }
          if (!hasVisibleAssistantReplySince(before)) appendAssistantMessage(text);
        };
        window.setTimeout(addIfStillMissing, 500);
      },
    }), [sendMessage, chatBusy, voice, stop, checkAndReserveQuota, isAdmin, assistantCount, hasVisibleAssistantReplySince, appendAssistantMessage]);

    const handleSubmit = () => {
      const text = input.trim();
      const img = pendingImage;
      if (!text && !img) return;
      if (chatBusy) return;
      if (voice.enabled) voice.prime();
      setInput("");
      setPendingImage(null);
      if (img) {
        if (!isAdmin) bumpScreenshotQuota();
        void sendMessage({
          text: text || "Scan THIS SCREENSHOT I just attached (not the current chart). Read the price action visible in the image and give me bias, entry, stop, TP1 and TP2 with a brief rationale.",
          files: [{ type: "file", mediaType: img.mediaType, url: img.url, filename: img.name }],
        });
      } else {
        void sendMessage({ text });
      }
    };

    function clearChat() {
      if (!confirm("Clear this conversation? (it's just the dashboard scratchpad)")) return;
      setMessages([]);
    }

    return (
      <div
        className="flex flex-col h-full min-h-0 bg-card overflow-hidden sm:rounded-xl border-y sm:border border-border shadow-2xl sm:shadow-xl relative"
        onPaste={(e) => {
          const items = e.clipboardData?.items;
          if (!items) return;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.kind === "file" && it.type.startsWith("image/")) {
              const f = it.getAsFile();
              if (f) {
                e.preventDefault();
                ingestFile(f);
                toast.success("Screenshot attached");
                return;
              }
            }
          }
        }}
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) ingestFile(f);
        }}
      >
        {dragging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/60 pointer-events-none">
            <div className="text-sm font-medium text-primary">Drop screenshot to attach</div>
          </div>
        )}
        {/* Header */}
        <div
          className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 bg-card/95 backdrop-blur"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${coachMeta.iconBg} ${coachMeta.iconText} shrink-0`}>
              <CoachIcon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">Chat</span>
              <span className="text-sm font-semibold text-foreground truncate">{activeCoach}</span>
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
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
              <div className="py-10 px-4 flex flex-col items-center gap-2 text-center">
                <MessageSquare className="h-5 w-5 text-muted-foreground/70" />
                <div className="text-xs text-muted-foreground max-w-xs">
                  Ask anything, or hit Run scan to grade the current setup. Every scan and reply lands here in your chat history.
                </div>
              </div>
            )}
            {messages.map((m) => {
              const raw = m.parts
                .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
                .join("");
              if (m.role === "assistant") {
                const parsed = parseAiPayload(raw);
                const g = parsed.grade;
                const summary = g
                  ? `${(g.bias || "neutral").toString().toUpperCase()} setup - Grade ${g.grade.toUpperCase()}${typeof g.entry === "number" ? ` · Entry ${g.entry}` : ""}${typeof g.stop === "number" ? ` · Stop ${g.stop}` : ""}`
                  : null;
                return (
                  <Message key={m.id} from={m.role}>
                    <div className="flex flex-col gap-2 max-w-full">
                      {g && <GradeCard grade={g} />}
                      {summary && (
                        <div className="text-sm text-foreground/90 leading-snug">{summary}</div>
                      )}
                      {parsed.concept && <ConceptDiagram concept={parsed.concept} />}
                      {parsed.annotations.length > 0 && (
                        <div className="text-[10px] uppercase tracking-wider text-primary/80">
                          Drawn on chart · {parsed.annotations.length} marker{parsed.annotations.length === 1 ? "" : "s"}
                        </div>
                      )}
                      {parsed.cleanText && (
                        g ? (
                          <details
                            className="group rounded-lg border border-border bg-card/40"
                            onToggle={(e) => {
                              const el = e.currentTarget as HTMLDetailsElement;
                              if (el.open) {
                                if (!voiceUnmutedIds.has(m.id)) return;
                                setSpeakingMsgId(m.id);
                                void voice.speak(parsed.cleanText, voiceForCoach(readActiveCoach()));
                              } else if (speakingMsgId === m.id) {
                                voice.stop();
                                setSpeakingMsgId(null);
                              }
                            }}
                          >
                            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center justify-between gap-2">
                              <span>Details</span>
                              <span className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    const isUnmuted = voiceUnmutedIds.has(m.id);
                                    if (!isUnmuted) {
                                      setVoiceUnmutedIds((prev: Set<string>) => { const n = new Set(prev); n.add(m.id); return n; });
                                      voice.prime();
                                      setSpeakingMsgId(m.id);
                                      void voice.speak(parsed.cleanText, voiceForCoach(readActiveCoach()));
                                    } else {
                                      setVoiceUnmutedIds((prev: Set<string>) => { const n = new Set(prev); n.delete(m.id); return n; });
                                      voice.stop();
                                      setSpeakingMsgId(null);
                                    }
                                  }}
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded border ${voiceUnmutedIds.has(m.id) ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted/60 text-muted-foreground animate-pulse"}`}
                                  title={voiceUnmutedIds.has(m.id) ? "Mute voice" : "Muted - tap to hear"}
                                  aria-label={voiceUnmutedIds.has(m.id) ? "Mute voice" : "Muted - tap to hear"}
                                >
                                  {voiceUnmutedIds.has(m.id)
                                    ? <Volume2 className="h-3.5 w-3.5" />
                                    : <VolumeX className="h-3.5 w-3.5" />}
                                </button>
                                <span className="text-[10px] opacity-60 group-open:hidden">Show</span>
                                <span className="text-[10px] opacity-60 hidden group-open:inline">Hide</span>
                              </span>
                            </summary>
                            <div className="px-3 pb-3 pt-1 border-t border-border/60">
                              <MessageResponse>{parsed.cleanText}</MessageResponse>
                            </div>
                          </details>
                        ) : (
                          <MessageResponse>{parsed.cleanText}</MessageResponse>
                        )
                      )}
                    </div>
                  </Message>
                );
              }
              return (
                <Message key={m.id} from={m.role}>
                  <MessageContent>{raw}</MessageContent>
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
          {pendingImage && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 p-1.5">
              <img src={pendingImage.url} alt="attachment preview" className="h-12 w-12 rounded object-cover border border-border/60" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{pendingImage.name}</div>
                <div className="text-[10px] text-muted-foreground">Ready to scan - press send</div>
              </div>
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                aria-label="Remove attachment"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) ingestFile(f);
              e.target.value = "";
            }}
          />
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingImage ? "Add a note (optional) and send…" : "Ask your coach, or paste a screenshot…"}
              rows={2}
            />
            <PromptInputFooter className="justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:border-primary/50 transition"
                  title="Attach a screenshot"
                  aria-label="Attach screenshot"
                >
                  <Paperclip className="h-3 w-3" />
                  <ImageIcon className="h-3 w-3" />
                </button>
                {loading ? (
                  <button
                    type="button"
                    onClick={stopScan}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/15 transition"
                  >
                    <Square className="h-3 w-3" /> Stop scan
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRunScan}
                    disabled={!onRunScan}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-primary/50 transition disabled:opacity-40"
                  >
                    <Crosshair className="h-3 w-3" /> Run scan
                  </button>
                )}
              </div>
              <PromptInputSubmit status={status} onStop={stopScan} disabled={!input.trim() && !pendingImage && !loading} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
);



  },
);
