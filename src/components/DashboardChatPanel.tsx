import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Link } from "@tanstack/react-router";
import { MessageSquare, ExternalLink, X, Minus, Volume2, VolumeX, Crosshair, Square, Paperclip, ImageIcon, ThumbsUp, ThumbsDown, HelpCircle, BookOpen, Zap, FileDown, NotebookPen } from "lucide-react";
import { downloadChatPdf } from "@/lib/chat-pdf";
import { stageChatForJournal } from "@/lib/chat-to-journal";
import { ScanStamp } from "@/components/ScanStamp";
import { recordHermesFeedback } from "@/lib/agents/hermes.functions";
import { COACH_ICON_META, DEFAULT_COACH_ICON } from "@/lib/coachMeta";
import { useFirstWeek } from "@/hooks/useFirstWeek";
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
import { useTimezone, formatInTimezone } from "@/hooks/useTimezone";
import { getOrCreateDashboardThread, getChatMessages, getActiveModel, appendAssistantChatMessage, type ActiveModelInfo } from "@/lib/chat.functions";
import { ActionLoader } from "@/components/ActionLoader";
import { clearLastThreadId, readJournal, readActiveCoach, writeActiveCoach, readActiveStrategy, readLastThreadId, writeLastThreadId } from "@/lib/chat-client";
import { readAnalysisModel } from "@/hooks/useAnalysisModel";

import { findStrategyByName } from "@/lib/customStrategies";
import { isAutoStrategy } from "@/lib/strategyAuto";
import { readActiveLensId, findLens } from "@/lib/scanLens";
import { useCoachVoice } from "@/hooks/useCoachVoice";
import { voiceForCoach } from "@/lib/coachVoices";
import { useProfile } from "@/hooks/useProfile";
import { compressImage, getScreenshotQuota, bumpScreenshotQuota } from "@/lib/imageCompress";
import { toast } from "sonner";
import { parseAiPayload, enforceGradeDirection, type ChartAnnotation, type ChartGrade, type ConceptRef } from "@/lib/chartAnnotations";
import { coalesceUiMessageStream, textFromUiMessageParts, friendlyChatError } from "@/lib/chat-stream";
import { ConceptDiagram } from "@/components/ConceptDiagram";
import { buildLearningPromptBlock } from "@/lib/signalLearning";
import { takeTrade } from "@/lib/signalHistory";
import { AiContextInspector } from "@/components/AiContextInspector";
import { AiCreditNotice } from "@/components/AiCreditNotice";


export type DashboardChatHandle = {
  scan: (prompt: string, targetThreadId?: string | null) => void;
  attach: (file: File, prompt: string, targetThreadId?: string | null) => void;
  ensureScanReply: (text: string, targetThreadId?: string | null) => void;
  appendScanReply: (text: string, targetThreadId?: string | null) => void;
  stop: () => void;
};

export type ChartContext = {
  ticker: string;
  intervalLabel: string;
  enabledLevels: string;
  /** TradingView-style symbol + raw interval so chat can render its own mini chart. */
  tvSymbol?: string;
  interval?: string;
  snapshot?: import("@/components/NativeChart").ChartSnapshot;
};


type Props = { chart?: ChartContext; onClose?: () => void; onMinimize?: () => void; onRunScan?: () => void; onStopScan?: () => void; scanning?: boolean; threadIdOverride?: string | null; onAnnotations?: (a: ChartAnnotation[]) => void; onConcept?: (c: ConceptRef | null) => void; onGrade?: (g: import("@/lib/chartAnnotations").ChartGrade | null) => void; onShowMe?: () => void; };

const DASHBOARD_THREAD_FALLBACK_ID = "dashboard-scans";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uiMessageText(message: UIMessage | null | undefined): string {
  return textFromUiMessageParts(message?.parts);
}

export const DashboardChatPanel = forwardRef<DashboardChatHandle, Props>(function DashboardChatPanel({ chart, onClose, onMinimize, onRunScan, onStopScan, scanning, threadIdOverride, onAnnotations, onConcept, onGrade, onShowMe }, ref) {
  const [threadId, setThreadId] = useState<string | null>(threadIdOverride ?? null);
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const innerRef = useRef<DashboardChatHandle | null>(null);
  const pendingRef = useRef<Array<{ type: "scan"; prompt: string } | { type: "attach"; file: File; prompt: string } | { type: "ensureScanReply"; text: string } | { type: "appendScanReply"; text: string }>>([]);
  const getThread = useServerFn(getOrCreateDashboardThread);
  const getMsgs = useServerFn(getChatMessages);
  const activeThreadRef = useRef<string | null>(threadId);
  useEffect(() => {
    activeThreadRef.current = threadId;
    if (threadId && threadId !== DASHBOARD_THREAD_FALLBACK_ID) writeLastThreadId(threadId);
  }, [threadId]);

  const shouldQueueForThread = useCallback((targetThreadId?: string | null) => {
    return !!targetThreadId && activeThreadRef.current !== targetThreadId;
  }, []);

  const flushPending = useCallback(() => {
    const inner = innerRef.current;
    if (!inner || pendingRef.current.length === 0) return;
    const pending = pendingRef.current.splice(0);
    pending.forEach((item) => {
      if (item.type === "scan") inner.scan(item.prompt);
      else if (item.type === "attach") inner.attach(item.file, item.prompt);
      else if (item.type === "ensureScanReply") inner.ensureScanReply(item.text);
      else inner.appendScanReply(item.text);
    });
  }, []);

  useImperativeHandle(ref, () => ({
    scan: (prompt: string, targetThreadId?: string | null) => {
      if (shouldQueueForThread(targetThreadId)) {
        pendingRef.current.push({ type: "scan", prompt });
        return;
      }
      if (innerRef.current) innerRef.current.scan(prompt);
      else pendingRef.current.push({ type: "scan", prompt });
    },
    attach: (file: File, prompt: string, targetThreadId?: string | null) => {
      if (shouldQueueForThread(targetThreadId)) {
        pendingRef.current.push({ type: "attach", file, prompt });
        return;
      }
      if (innerRef.current) innerRef.current.attach(file, prompt);
      else pendingRef.current.push({ type: "attach", file, prompt });
    },
    ensureScanReply: (text: string, targetThreadId?: string | null) => {
      if (shouldQueueForThread(targetThreadId)) {
        pendingRef.current.push({ type: "ensureScanReply", text });
        return;
      }
      if (innerRef.current) innerRef.current.ensureScanReply(text);
      else pendingRef.current.push({ type: "ensureScanReply", text });
    },
    appendScanReply: (text: string, targetThreadId?: string | null) => {
      if (shouldQueueForThread(targetThreadId)) {
        pendingRef.current.push({ type: "appendScanReply", text });
        return;
      }
      if (innerRef.current) innerRef.current.appendScanReply(text);
      else pendingRef.current.push({ type: "appendScanReply", text });
    },
    stop: () => {
      pendingRef.current = [];
      innerRef.current?.stop();
    },
  }), [shouldQueueForThread]);

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
    innerRef.current = null;
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

      // If a specific thread was requested, just load its messages. When none
      // was passed, fall back to the last thread this browser used: the chat
      // API retitles the scratch thread after the instrument on the chart, so
      // looking it up by its original title would create a fresh empty thread
      // and the previous replies would look deleted.
      const preferredThreadId = threadIdOverride ?? readLastThreadId();
      if (preferredThreadId) {
        try {
          const rows = await getMsgs({ data: { threadId: preferredThreadId } });
          if (!cancelled) {
            setThreadId(preferredThreadId);
            setInitial(rows as UIMessage[]);
          }
          return;
        } catch (e) {
          console.warn("[chat] load thread failed", e);
          clearLastThreadId(preferredThreadId);
        }
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
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-card text-xs text-muted-foreground sm:rounded-xl border-y sm:border border-border/60">
        <ActionLoader label="Loading your conversation" hint="Bringing back your last replies and scans." />
      </div>
    );
  }

  return <ChatInner key={threadId} ref={innerRef} threadId={threadId} initial={initial} chart={chart} onClose={onClose} onMinimize={onMinimize} onRunScan={onRunScan} onStopScan={onStopScan} scanning={scanning} onAnnotations={onAnnotations} onConcept={onConcept} onGrade={onGrade} onShowMe={onShowMe} />;
});


// Price display helpers. The model streams raw floats (e.g. 3991.1399999999994)
// which look broken in the card, so every level is rounded to the instrument's
// tick precision before it is stored or rendered.
function decimalsForPrice(px: number): number {
  if (px >= 1000) return 2;
  if (px >= 10) return 3;
  if (px >= 1) return 4;
  return 5;
}
function roundPrice(n: number, px: number): number {
  const d = decimalsForPrice(px);
  return Number(n.toFixed(d));
}
function formatPrice(n?: number, ref?: number): string {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  const d = decimalsForPrice(ref && isFinite(ref) && ref > 0 ? ref : n);
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function sanitizeGradeForPrice(grade: ChartGrade, lastPrice?: number): ChartGrade {
  const bias = grade.bias ?? "neutral";
  if (!lastPrice || !isFinite(lastPrice) || lastPrice <= 0 || typeof grade.entry !== "number" || typeof grade.stop !== "number") return grade;
  if (!isFinite(grade.entry) || !isFinite(grade.stop)) return grade;
  // Scan-engine cards have already passed deterministic structure, ATR, and
  // direction validation. Re-clamping them here created a second entry price
  // that no longer matched the Setup chart or the engine's written thesis.
  // Only round trusted scan levels for display; sanitize free-form coach cards.
  if (grade.dataSource) {
    const r = (n?: number) => (typeof n === "number" && isFinite(n) ? roundPrice(n, lastPrice) : n);
    const g = enforceGradeDirection(grade) ?? grade;
    return { ...g, entry: r(g.entry), stop: r(g.stop), tp1: r(g.tp1), tp2: r(g.tp2) };
  }
  // Risk and pullback distance both get a sane ceiling so the chat card can
  // never show an entry parked far away from where price actually is.
  const maxRisk = lastPrice * 0.006;
  const maxGap = lastPrice * 0.004;
  const riskBase = Math.min(Math.max(Math.abs(grade.entry - grade.stop), lastPrice * 0.001), maxRisk);
  const tol = Math.max(lastPrice * 0.0001, riskBase * 0.05);
  let entry = grade.entry;
  let stop = grade.stop;
  let tp1 = grade.tp1;
  let tp2 = grade.tp2;
  if (bias === "long" && entry > lastPrice + tol) entry = lastPrice;
  if (bias === "short" && entry < lastPrice - tol) entry = lastPrice;
  // Keep the entry a realistic pullback away from price.
  if (bias === "long" && lastPrice - entry > maxGap) entry = lastPrice - maxGap;
  if (bias === "short" && entry - lastPrice > maxGap) entry = lastPrice + maxGap;
  const risk = Math.min(Math.max(Math.abs(entry - stop), lastPrice * 0.001), maxRisk);
  if (bias === "long") {
    stop = entry - risk;
    tp1 = typeof tp1 === "number" && isFinite(tp1) ? Math.max(tp1, entry + risk * 1.5) : entry + risk * 1.5;
    tp2 = typeof tp2 === "number" && isFinite(tp2) ? Math.max(tp2, tp1 + risk * 1.5, entry + risk * 3) : entry + risk * 3;
  } else if (bias === "short") {
    stop = entry + risk;
    tp1 = typeof tp1 === "number" && isFinite(tp1) ? Math.min(tp1, entry - risk * 1.5) : entry - risk * 1.5;
    tp2 = typeof tp2 === "number" && isFinite(tp2) ? Math.min(tp2, tp1 - risk * 1.5, entry - risk * 3) : entry - risk * 3;
  }
  const r = (n?: number) => (typeof n === "number" && isFinite(n) ? roundPrice(n, lastPrice) : n);
  const out = enforceGradeDirection({ ...grade, entry, stop, tp1, tp2 }) ?? grade;
  return { ...out, entry: r(out.entry), stop: r(out.stop), tp1: r(out.tp1), tp2: r(out.tp2) };
}


function orderTypeFor(grade: ChartGrade, lastPrice?: number): string | null {
  if (!lastPrice || typeof grade.entry !== "number" || !isFinite(lastPrice) || !isFinite(grade.entry)) return null;
  const tol = Math.max(lastPrice * 0.0005, 0);
  if (grade.bias === "long") {
    if (grade.entry > lastPrice + tol) return "BUY STOP";
    if (grade.entry < lastPrice - tol) return "BUY LIMIT";
    return "BUY MARKET";
  }
  if (grade.bias === "short") {
    if (grade.entry < lastPrice - tol) return "SELL STOP";
    if (grade.entry > lastPrice + tol) return "SELL LIMIT";
    return "SELL MARKET";
  }
  return null;
}

/**
 * The coach note traders read first is one line. Everything else - the full
 * case for the trade and the risk / invalidation - sits behind "Full analysis",
 * so the top of the card is not lopsided towards the risk paragraph.
 */
function firstSentence(text: string): string {
  const t = text.trim();
  const m = t.match(/^.*?[.!?](\s|$)/);
  const head = (m ? m[0] : t).trim();
  return head.length > 180 ? `${head.slice(0, 177)}...` : head;
}

function GradeNarrative({ strength, weakness }: { strength?: string; weakness?: string }) {
  const [open, setOpen] = useState(false);
  const note = strength ? firstSentence(strength) : weakness ? firstSentence(weakness) : "";
  const hasMore =
    (!!strength && strength.trim() !== note) || (!!weakness && weakness !== strength);
  return (
    <div className="border-t border-border/60 p-2 space-y-1.5 text-xs">
      {note && (
        <div>
          <span className="font-semibold text-foreground">Coach note: </span>
          <span className="text-foreground/90">{note}</span>
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] font-semibold tracking-tight text-primary hover:underline"
        >
          {open ? "Hide full analysis" : "Full analysis"}
        </button>
      )}
      {open && (
        <div className="space-y-1 rounded-xl border border-border/50 bg-background/40 p-2">
          {strength && (
            <div><span className="text-bull font-semibold">Why take this trade: </span><span className="text-foreground/90">{strength}</span></div>
          )}
          {weakness && weakness !== strength && (
            <div><span className="text-red-400 font-semibold">Risk and invalidation: </span><span className="text-foreground/90">{weakness}</span></div>
          )}
        </div>
      )}
    </div>
  );
}

function GradeCard({ grade, lastPrice, symbol, interval }: { grade: ChartGrade; lastPrice?: number; symbol?: string; interval?: string }) {
  const g = grade.grade.toUpperCase();
  const tone = g.startsWith("A") ? "text-bull border-bull/40 bg-bull/10"
    : g.startsWith("B") ? "text-lime-300 border-lime-500/40 bg-lime-500/10"
    : g.startsWith("C") ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
    : g.startsWith("D") ? "text-orange-300 border-orange-500/40 bg-orange-500/10"
    : "text-red-300 border-red-500/40 bg-red-500/10";
  const biasTone = grade.bias === "long" ? "text-bull"
    : grade.bias === "short" ? "text-red-300"
    : "text-muted-foreground";
  const fmt = (n?: number) => formatPrice(n, lastPrice ?? grade.entry);
  const orderType = orderTypeFor(grade, lastPrice);
  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
      <div className={`flex items-center justify-between px-3 py-2 border-b border-border/60 ${tone.split(" ").filter((c) => c.startsWith("bg-")).join(" ")}`}>
        <div className="flex items-baseline gap-2">
          <span className={`text-lg font-bold leading-none ${tone.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`}>{g}</span>
          <span className="text-[10px] tracking-tight text-muted-foreground">Grade</span>
        </div>
        {grade.bias && (
          <span className={`text-xs font-semibold ${biasTone}`}>{grade.bias}</span>
        )}
      </div>
      {orderType && (
        <div className="border-b border-border/60 px-3 py-1 text-[10px] font-semibold tracking-tight text-muted-foreground">
          Order type: <span className={biasTone}>{orderType}</span>
        </div>
      )}
      <div className="border-b border-border/60 px-3 py-1">
        <ScanStamp
          fetchedAt={grade.dataFetchedAt}
          refPrice={typeof grade.refPrice === "number" ? grade.refPrice : lastPrice}
          dataSource={grade.dataSource}
          candleCount={grade.candleCount}
        />
      </div>
      <div className="grid grid-cols-4 divide-x divide-border/60 text-center">
        {(["entry","stop","tp1","tp2"] as const).map((k) => (
          <div key={k} className="p-2">
            <div className="text-[9px] tracking-tight text-muted-foreground">{k}</div>
            <div className="text-xs font-mono text-foreground">{fmt(grade[k])}</div>
          </div>
        ))}
      </div>
      {(grade.strength || grade.weakness) && (
        <GradeNarrative strength={grade.strength} weakness={grade.weakness} />
      )}
      {(grade.bias === "long" || grade.bias === "short") && (
        <div className="flex items-center gap-2 border-t border-border/60 p-2">
          <button
            type="button"
            onClick={() =>
              takeTrade({
                symbol: symbol ?? "",
                bias: grade.bias === "long" ? "Long" : "Short",
                interval,
                grade: grade.grade,
                entry: grade.entry,
                stop: grade.stop,
                tp1: grade.tp1,
                tp2: grade.tp2,
                why: grade.strength,
                risk: grade.weakness,
              })
            }
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[10px] font-bold tracking-tight bg-primary text-primary-foreground hover:opacity-90"
            title="Log this setup in your trade journal"
          >
            <BookOpen className="h-3 w-3" /> Log this trade
          </button>

        </div>
      )}
    </div>
  );
}


const ChatInner = forwardRef<DashboardChatHandle, { threadId: string; initial: UIMessage[]; chart?: ChartContext; onClose?: () => void; onMinimize?: () => void; onRunScan?: () => void; onStopScan?: () => void; scanning?: boolean; onAnnotations?: (a: ChartAnnotation[]) => void; onConcept?: (c: ConceptRef | null) => void; onGrade?: (g: import("@/lib/chartAnnotations").ChartGrade | null) => void; onShowMe?: () => void }>(
  function ChatInner({ threadId, initial, chart, onClose, onMinimize, onRunScan, onStopScan, scanning, onAnnotations, onConcept, onGrade, onShowMe }, ref) {

    const [input, setInput] = useState("");
    // Up to 5 screenshots per message, like ChatGPT - send, then attach more.
    const MAX_IMAGES = 5;
    const [pendingImages, setPendingImages] = useState<Array<{ url: string; name: string; mediaType: string }>>([]);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [activeCoach, setActiveCoach] = useState<string>(() => readActiveCoach());
    // Coach switches must land on the very next reply, so re-read the stored
    // coach on same-tab switches, cross-tab writes, and window focus.
    useEffect(() => {
      const sync = () => setActiveCoach(readActiveCoach());
      window.addEventListener("trademind:coach", sync);
      window.addEventListener("storage", sync);
      window.addEventListener("focus", sync);
      return () => {
        window.removeEventListener("trademind:coach", sync);
        window.removeEventListener("storage", sync);
        window.removeEventListener("focus", sync);
      };
    }, []);
    // Which coach wrote the previous turn in this thread, so the model knows to
    // drop the old voice instead of mimicking it from history.
    const lastSentCoachRef = useRef<string | null>(null);
    const coachMeta = COACH_ICON_META[activeCoach] ?? DEFAULT_COACH_ICON;
    const CoachIcon = coachMeta.icon;
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const chartRef = useRef<ChartContext | undefined>(chart);
    useEffect(() => { chartRef.current = chart; }, [chart]);

    const voice = useCoachVoice();
    const [activeModel, setActiveModel] = useState<ActiveModelInfo | null>(null);
    const getModel = useServerFn(getActiveModel);
    const persistAssistant = useServerFn(appendAssistantChatMessage);
    useEffect(() => {
      getModel().then(setActiveModel).catch(() => setActiveModel(null));
    }, [getModel]);
    const { isAdmin } = useProfile();
    const { resolvedTimezone } = useTimezone();
    const [now, setNow] = useState<Date>(() => new Date());
    useEffect(() => {
      const t = setInterval(() => setNow(new Date()), 30_000);
      return () => clearInterval(t);
    }, []);
    const headerDate = formatInTimezone(now, resolvedTimezone, { month: "short", day: "numeric" });
    const headerTime = formatInTimezone(now, resolvedTimezone, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    const headerInstrument = chart?.ticker || "No instrument";
    // Voice defaults to muted per-message; the user must tap the speaker to unmute.
    const [voiceUnmutedIds, setVoiceUnmutedIds] = useState<Set<string>>(() => new Set());
    const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
    const [feedbackByMsg, setFeedbackByMsg] = useState<Record<string, 1 | -1>>({});
    const submitFeedback = useServerFn(recordHermesFeedback);
    const sendFeedback = useCallback(async (msgId: string, rating: 1 | -1, grade: ChartGrade | null) => {
      if (feedbackByMsg[msgId]) return;
      setFeedbackByMsg((prev) => ({ ...prev, [msgId]: rating }));
      try {
        await submitFeedback({ data: {
          kind: grade ? "scan" : "chat",
          ticker: chartRef.current?.ticker ?? null,
          interval: chartRef.current?.intervalLabel ?? null,
          lens: readActiveLensId(),
          coach: readActiveCoach(),
          rating,
          note: null,
          context: grade ? { grade: grade.grade, bias: grade.bias, entry: grade.entry, stop: grade.stop } : {},
        } });
        toast.success(rating === 1 ? "Thanks - Hermes will remember this" : "Noted - Hermes will down-weight this");
      } catch (e) {
        setFeedbackByMsg((prev) => { const n = { ...prev }; delete n[msgId]; return n; });
        toast.error(e instanceof Error ? e.message : "Could not save feedback");
      }
    }, [feedbackByMsg, submitFeedback]);

    const checkAndReserveQuota = useCallback((): boolean => {
      if (isAdmin) return true;
      const q = getScreenshotQuota();
      if (q.remaining <= 0) {
        toast.error(`Daily screenshot limit reached (${q.limit}/day). Try again tomorrow.`);
        return false;
      }
      return true;
    }, [isAdmin]);

    const ingestFiles = useCallback(async (input: FileList | File[] | null | undefined) => {
      const all = Array.from(input ?? []);
      const files = all.filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        if (all.length) toast.error("Only image files can be attached");
        return;
      }
      let added = 0;
      for (const file of files) {
        let full = false;
        setPendingImages((prev) => { full = prev.length + added >= MAX_IMAGES; return prev; });
        if (full) { toast.error(`Up to ${MAX_IMAGES} images per message - send these first`); break; }
        if (!checkAndReserveQuota()) break;
        try {
          const { dataUrl, name, mediaType } = await compressImage(file);
          added += 1;
          setPendingImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, { url: dataUrl, name, mediaType }]));
        } catch (e) {
          console.error(e);
          toast.error("Could not read that image");
        }
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
          return coalesceUiMessageStream(await fetch(input, { ...init, headers }));
        },
        prepareSendMessagesRequest: ({ messages, id }) => {
          const stratName = readActiveStrategy();
          const strategy = stratName && !isAutoStrategy(stratName) ? findStrategyByName(stratName) ?? { name: stratName } : null;
          const lens = findLens(readActiveLensId());
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
              chart: chartRef.current,
              strategy,
              lens: { id: lens.id, name: lens.name, promptEmphasis: lens.promptEmphasis },
              signalLearning: buildLearningPromptBlock(),
              analysisModel: readAnalysisModel(),

            },
          };
        },

      }),
      onError: (err) => {
        console.error(err);
        const msg = friendlyChatError(err).trim();
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
        const raw = uiMessageText(m);
        const parsed = parseAiPayload(raw);
        return !!parsed.cleanText || !!parsed.grade || !!parsed.concept || parsed.annotations.length > 0;
      });
    }, []);

    const appendAssistantMessage = useCallback((text: string) => {
      // Persist it too: this message is generated client-side (the Analysis
      // engine's grade card), so without this the setup disappears when the
      // thread is reopened from history. Retried, because a transient save
      // failure used to silently lose the scan from history.
      const id = crypto.randomUUID();
      if (UUID_RE.test(threadId)) {
        const save = async (attempt = 0): Promise<void> => {
          try {
            await persistAssistant({ data: { threadId, text, msgId: id } });
          } catch (e) {
            if (attempt >= 3) {
              console.warn("[chat] scan card not saved to history", e);
              return;
            }
            try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
            await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
            return save(attempt + 1);
          }
        };
        void save();
      }
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: "assistant",
          parts: [{ type: "text", text }],
        } as UIMessage,
      ]);
    }, [setMessages, threadId, persistAssistant]);


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
    // Seeded with the last assistant message already in history so reopening a
    // thread does not yank the user to the chart for an old reply.
    const autoShownRef = useRef<string | null>(
      [...initial].reverse().find((m) => m.role === "assistant")?.id ?? null,
    );
    // Only the newest assistant reply is ever lifted to the chart, and only
    // once. Re-lifting on unrelated re-renders (history loads, coach switches,
    // price ticks) is what let an older scan's grade land back on the chart
    // while the chat bubble showed the newer one.
    const liftedRef = useRef<string | null>(null);
    useEffect(() => {
      const last = [...messages].reverse().find((m) => m.role === "assistant");
      if (!last) return;
      const text = uiMessageText(last);
      const parsed = parseAiPayload(text);
      const signature = `${last.id}:${text.length}`;
      const alreadyLifted = liftedRef.current === signature;
      if (!alreadyLifted) {
        liftedRef.current = signature;
        // An empty annotation list means "this reply drew nothing", not "erase
        // the setup" - the scan's own entry/stop/target lines must survive a
        // follow-up coaching reply.
        if (onAnnotations && parsed.annotations.length > 0) onAnnotations(parsed.annotations);
        if (onConcept) onConcept(parsed.concept ?? null);
        // The card the trader reads is sanitized exactly once, here. The
        // dashboard redraws the chart from these same numbers, so the lines and
        // the card can never quote different entries.
        if (onGrade && parsed.grade) onGrade(sanitizeGradeForPrice(parsed.grade, chart?.snapshot?.lastPrice));
      }


      // Auto "show me": once a reply finishes and it carries something drawable
      // (levels or a graded plan), flip the chart to Setup so the trader sees
      // the reasoning on the chart without having to ask for it.
      const busy = status === "submitted" || status === "streaming";
      const hasDrawable = parsed.annotations.length > 0 || !!parsed.grade;
      if (!busy && hasDrawable && autoShownRef.current !== last.id) {
        autoShownRef.current = last.id;
        onShowMe?.();
      }
    }, [messages, status, onAnnotations, onConcept, onGrade, onShowMe, chart?.snapshot?.lastPrice]);





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
        const addIfStillMissing = () => {
          if (before !== lastScanAssistantCountRef.current) return;
          if (hasVisibleAssistantReplySince(before)) return;
          appendAssistantMessage(text);
        };
        window.setTimeout(addIfStillMissing, 500);
      },
      appendScanReply: (text: string) => {
        const appendWhenCoachIsDone = () => {
          if (statusRef.current === "submitted" || statusRef.current === "streaming") {
            window.setTimeout(appendWhenCoachIsDone, 350);
            return;
          }
          appendAssistantMessage(text);
        };
        appendWhenCoachIsDone();
      },
    }), [sendMessage, chatBusy, voice, stop, checkAndReserveQuota, isAdmin, assistantCount, hasVisibleAssistantReplySince, appendAssistantMessage]);

    const handleSubmit = () => {
      const text = input.trim();
      const imgs = pendingImages;
      if (!text && !imgs.length) return;
      if (chatBusy) return;
      if (voice.enabled) voice.prime();
      // "show me ..." means the coach will draw on the chart - jump to Setup view.
      if (text && /\bshow\s*me\b/i.test(text)) onShowMe?.();
      setInput("");
      setPendingImages([]);
      if (imgs.length) {
        if (!isAdmin) for (let i = 0; i < imgs.length; i++) bumpScreenshotQuota();
        void sendMessage({
          text: text || `Scan ${imgs.length > 1 ? `THESE ${imgs.length} SCREENSHOTS` : "THIS SCREENSHOT"} I just attached (ignore the live chart context above - analyze only what is in the image${imgs.length > 1 ? "s, treating them as the same idea across timeframes/views" : ""}). IMPORTANT: The horizontal line at the current price cursor is NOT the entry - it is just where price is right now. Determine entry from actual structure visible in the image: order blocks, FVGs, swing highs/lows, liquidity pools, trendline touches, or a labeled level the user drew. If the user drew entry/SL/TP lines on the chart, read those literally. Otherwise propose entry at a structural level (not at current price unless it is also a valid structural level), place stop beyond the invalidation structure (swing high/low or opposite side of the zone), and set TP1/TP2 at the next liquidity or structural targets visible. State bias, entry, stop, TP1, TP2, R:R, and a 1-2 sentence rationale that references the specific structure you saw.`,
          files: imgs.map((img) => ({ type: "file" as const, mediaType: img.mediaType, url: img.url, filename: img.name })),
        });
      } else {
        void sendMessage({ text });
      }
    };

    return (
      <div
        className="relative grid h-full max-h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden border-y border-border/50 bg-background sm:rounded-2xl sm:border"
        data-testid="dashboard-chat-panel"
        onPaste={(e) => {
          const items = Array.from(e.clipboardData?.items ?? []);
          const files = items
            .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
            .map((it) => it.getAsFile())
            .filter((f): f is File => !!f);
          if (files.length) {
            e.preventDefault();
            void ingestFiles(files);
            toast.success(files.length > 1 ? `${files.length} screenshots attached` : "Screenshot attached");
          }
        }}
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingestFiles(e.dataTransfer?.files);
        }}
      >
        {dragging && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary/60 pointer-events-none">
            <div className="text-sm font-medium text-primary">Drop screenshot to attach</div>
          </div>
        )}
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 bg-card/95 backdrop-blur"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${coachMeta.iconBg} ${coachMeta.iconText} shrink-0`}>
              <CoachIcon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-foreground truncate leading-tight">{activeCoach}</span>
              <span className="text-[10px] text-muted-foreground leading-tight truncate">
                <span className="font-medium text-foreground/80">{headerInstrument}</span>
                <span className="mx-1 opacity-50">·</span>{headerDate}
                <span className="mx-1 opacity-50">·</span>{headerTime}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            {activeModel && (
              <span
                className="hidden sm:inline text-[10px] font-medium text-muted-foreground truncate max-w-[120px]"
                title={`Powered by ${activeModel.label}`}
              >
                {activeModel.label}
              </span>
            )}
            <Link
              to="/chat"
              className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition"
              title="Open full chat"
              aria-label="Open full chat"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
            {onClose && (
              <button
                onClick={onClose}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent/60 transition"
                title="Close coach"
                aria-label="Close coach"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 shrink-0">
          <AiCreditNotice />
          {messages.length > 0 && (
            <AiContextInspector messages={messages} className="mx-3 mb-1" />
          )}
        </div>

        {/* This is the panel's only scrolling region. Everything below it stays
            in normal flow so the composer can never be clipped off screen. */}
        <Conversation
          className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain"
          data-testid="dashboard-chat-messages"
        >
          <ConversationContent className="min-w-0 max-w-full overflow-x-hidden px-3 py-4 [&_*]:max-w-full">
            {messages.length === 0 && (
              <div className="py-10 px-4 flex flex-col items-center gap-2 text-center">
                <MessageSquare className="h-5 w-5 text-muted-foreground/70" />
                <div className="text-xs text-muted-foreground max-w-xs">
                  Ask anything, or hit Run scan to grade the current setup. Every scan and reply lands here in your chat history.
                </div>
              </div>
            )}
            {messages.map((m) => {
              const raw = uiMessageText(m);
              if (m.role === "assistant") {
                const parsed = parseAiPayload(raw);
                const g = parsed.grade ? sanitizeGradeForPrice(parsed.grade, chart?.snapshot?.lastPrice) : undefined;
                const summary = g
                  ? `${(g.bias || "neutral").toString().toUpperCase()} setup - Grade ${g.grade.toUpperCase()}${typeof g.entry === "number" ? ` · Entry ${formatPrice(g.entry, chart?.snapshot?.lastPrice)}` : ""}${typeof g.stop === "number" ? ` · Stop ${formatPrice(g.stop, chart?.snapshot?.lastPrice)}` : ""}`
                  : null;
                return (
                  <Message key={m.id} from={m.role} className="min-w-0 max-w-full overflow-hidden">
                    <div className="flex min-w-0 max-w-full flex-col gap-2 overflow-hidden break-words">
                      {/* Who is speaking. Traders switch coaches to hear a different
                          voice, so every reply is attributed on screen. */}
                      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
                        <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${coachMeta.iconBg} ${coachMeta.iconText}`}>
                          <CoachIcon className="h-2.5 w-2.5" />
                        </span>
                        <span className="shrink-0 font-medium text-foreground/80">{activeCoach}</span>
                        <span className="truncate text-muted-foreground/60">· {coachMeta.tagline}</span>
                      </div>
                      {g && <GradeCard grade={g} lastPrice={chart?.snapshot?.lastPrice} symbol={chart?.ticker} />}
                      {summary && (
                        <div className="min-w-0 break-words text-sm leading-snug text-foreground/90">{summary}</div>
                      )}
                      {parsed.concept && <ConceptDiagram concept={parsed.concept} />}
                      {parsed.annotations.length > 0 && (
                        <div className="text-[11px] font-medium text-muted-foreground">
                          Drawn on chart · {parsed.annotations.length} marker{parsed.annotations.length === 1 ? "" : "s"}
                        </div>
                      )}
                      {parsed.cleanText && (
                        g ? (
                          <details
                            className="group min-w-0 max-w-full overflow-hidden rounded-2xl border border-border/50 bg-card"
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
                            <summary className="cursor-pointer select-none px-3.5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground flex items-center justify-between gap-2">
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
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded border ${voiceUnmutedIds.has(m.id) ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 bg-muted/60 text-muted-foreground animate-pulse"}`}
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
                            <div className="min-w-0 overflow-x-auto break-words border-t border-border/60 px-3 pb-3 pt-1">
                              <MessageResponse>{parsed.cleanText}</MessageResponse>
                            </div>
                          </details>
                        ) : (
                          <MessageResponse>{parsed.cleanText}</MessageResponse>
                        )
                      )}
                      {(parsed.cleanText || g) && (
                        <div className="flex items-center gap-1.5 pt-1 opacity-90">
                          <span className="text-[10px] tracking-tight text-muted-foreground mr-1">Was this helpful?</span>
                          <button
                            type="button"
                            disabled={!!feedbackByMsg[m.id]}
                            onClick={() => void sendFeedback(m.id, 1, g ?? null)}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition ${feedbackByMsg[m.id] === 1 ? "border-bull/50 bg-bull/15 text-bull" : "border-border/60 bg-muted/50 text-muted-foreground hover:text-bull hover:border-bull/40"}`}
                            title="Helpful - teach Hermes"
                            aria-label="Helpful"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!!feedbackByMsg[m.id]}
                            onClick={() => void sendFeedback(m.id, -1, g ?? null)}
                            className={`inline-flex h-7 w-7 items-center justify-center rounded border transition ${feedbackByMsg[m.id] === -1 ? "border-red-500/50 bg-red-500/15 text-red-300" : "border-border/60 bg-muted/50 text-muted-foreground hover:text-red-300 hover:border-red-500/40"}`}
                            title="Not helpful - teach Hermes"
                            aria-label="Not helpful"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </Message>
                );
              }
              const displayMatch = raw.match(/^<<<SCAN_DISPLAY:([^>]*)>>>/);
              const userText = displayMatch ? displayMatch[1] : raw;
              return (
                <Message key={m.id} from={m.role} className="min-w-0 max-w-full overflow-hidden">
                  <MessageContent className="min-w-0 max-w-full break-words">{userText}</MessageContent>
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
          className="sticky bottom-0 z-20 min-w-0 shrink-0 overflow-visible border-t border-border/50 bg-background p-2.5 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] [@media(max-height:700px)]:py-2"
          data-testid="dashboard-chat-composer"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {pendingImages.length > 0 && (
            <div className="mb-2 rounded-2xl border border-border/50 bg-card p-2">
              <div className="flex flex-wrap gap-2">
                {pendingImages.map((img, i) => (
                  <div key={img.url} className="relative">
                    <img src={img.url} alt={`attachment ${i + 1}`} className="h-14 w-14 rounded-xl object-cover border border-border/50" />
                    <button
                      type="button"
                      onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 inline-flex items-center justify-center rounded-full bg-background border border-border/60 text-muted-foreground hover:text-destructive transition"
                      aria-label={`Remove attachment ${i + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                {pendingImages.length}/{MAX_IMAGES} images - press send{pendingImages.length >= MAX_IMAGES ? " (max reached, send then add more)" : ""}
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void ingestFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <QuickPrompts
            ticker={chart?.ticker}
            intervalLabel={chart?.intervalLabel}
            hasImage={pendingImages.length > 0}
            lastAssistant={[...messages].reverse().find((m) => m.role === "assistant") ?? null}
            disabled={chatBusy}
            onPick={(text) => {
              if (chatBusy) return;
              if (voice.enabled) voice.prime();
              setInput("");
              void sendMessage({ text });
            }}
          />
          <PromptInput
            onSubmit={handleSubmit}
            className="min-w-0 overflow-visible [&_[data-slot=input-group]]:overflow-visible"
          >
            <PromptInputTextarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={pendingImages.length ? "Add a note (optional), then send" : "Ask your coach or paste a chart screenshot"}
              rows={3}
              aria-label="Message your AI coach"
              className="min-h-[60px] max-h-[120px] whitespace-pre-wrap rounded-2xl border border-border/60 bg-card py-2.5 text-sm leading-relaxed placeholder:whitespace-normal placeholder:text-muted-foreground placeholder:opacity-100 [@media(max-height:700px)]:min-h-[48px] [@media(max-height:700px)]:max-h-[88px]"
            />
            <PromptInputFooter className="flex-wrap justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition"
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
                    className="inline-flex items-center gap-1.5 rounded-full bg-destructive/12 px-3.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition"
                  >
                    <Square className="h-3 w-3" /> Stop scan
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRunScan}
                    disabled={!onRunScan}
                    className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition disabled:opacity-40"
                  >
                    <Crosshair className="h-3 w-3" /> Run scan
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    toast.info("Show Me", {
                      description:
                        'Type "show me" before your question in the chat (e.g. "show me a good entry on XAU/USD") and the coach will draw the setup right on your chart: entry, stop, and targets.',
                      duration: 8000,
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition"
                  title='Type "show me" in chat to have the coach mark up the chart'
                  aria-label="Learn about Show Me"
                >
                  <HelpCircle className="h-3 w-3" /> Show Me
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!messages.length) return;
                    void downloadChatPdf(messages, { coach: activeCoach, instrument: headerInstrument });
                  }}
                  disabled={!messages.length}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition disabled:opacity-40"
                  title="Download this conversation as a PDF"
                  aria-label="Download conversation PDF"
                >
                  <FileDown className="h-3 w-3" /> PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!messages.length) return;
                    const ok = stageChatForJournal(messages, { coach: activeCoach, instrument: headerInstrument });
                    if (ok) {
                      toast.success("Conversation saved", {
                        description: "Open the Journal and log the trade, the chat attaches to that entry.",
                      });
                    } else {
                      toast.error("Could not save this conversation");
                    }
                  }}
                  disabled={!messages.length}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent/60 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition disabled:opacity-40"
                  title="Attach this conversation to your next journal entry"
                  aria-label="Save conversation to journal"
                >
                  <NotebookPen className="h-3 w-3" /> To journal
                </button>
              </div>
              <PromptInputSubmit status={status} onStop={stopScan} disabled={!input.trim() && !pendingImages.length && !loading} />
            </PromptInputFooter>
          </PromptInput>
          <p className="mt-1 text-center text-[10px] text-muted-foreground/80">
            Educational analysis only, not financial advice.
          </p>
        </div>
      </div>

);



  },
);

function QuickPrompts({
  ticker,
  intervalLabel,
  hasImage,
  lastAssistant,
  disabled,
  onPick,
}: {
  ticker?: string;
  intervalLabel?: string;
  hasImage: boolean;
  lastAssistant: UIMessage | null;
  disabled?: boolean;
  onPick: (text: string) => void;
}) {
  const sym = ticker || "this instrument";
  const tf = intervalLabel || "current timeframe";
  const lastText = lastAssistant
    ? lastAssistant.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join(" ")
        .toLowerCase()
    : "";
  const mentionsGrade = /grade|entry|stop|tp1|tp2|bias|setup/.test(lastText);
  const { active, completedCount, total, nextTask } = useFirstWeek();
  const onboardingPrompts: { icon: string; label: string; text: string }[] = [];

  if (active) {
    if (!nextTask || completedCount >= total) {
      onboardingPrompts.push({ icon: "◈", label: "What should I focus on next?", text: "I have completed my first week checklist. What should I focus on next to improve my trading?" });
    } else {
      const id = nextTask.id;
      if (id === "academy") onboardingPrompts.push({ icon: "◆", label: "What should I learn first?", text: "I am new to TradeMind. What is the first trading concept I should learn, and why?" });
      if (id === "flashcards") onboardingPrompts.push({ icon: "◆", label: "Quiz me on basics", text: "Quiz me on the most important trading basics I need to know before placing a trade." });
      if (id === "discord") onboardingPrompts.push({ icon: "◆", label: "How do I join the community?", text: "What happens in the TradeMind Community Discord and how do I get the most out of it?" });
      if (id === "testing") onboardingPrompts.push({ icon: "◆", label: "How does paper trading work?", text: "Explain how Testing mode works on TradeMind, including the $10,000 account and kill switch." });
      if (id === "journal") onboardingPrompts.push({ icon: "◆", label: "Why journal every trade?", text: "Why should I log every trade in the TradeMind journal, and what should I write down?" });
      if (id === "quiz") onboardingPrompts.push({ icon: "◆", label: "How do module quizzes work?", text: "How do TradeMind Academy quizzes and certificates work? What score do I need?" });
      if (id === "risk-calculator") onboardingPrompts.push({ icon: "◆", label: "How do I size a trade?", text: "Walk me through how to use the TradeMind risk calculator to size a position correctly." });
      if (id === "briefings") onboardingPrompts.push({ icon: "◆", label: "Set up daily briefings", text: "What are the TradeMind morning and evening briefings, and how do I set them up?" });
      if (id === "review") onboardingPrompts.push({ icon: "◆", label: "How does spaced review work?", text: "Explain how the wrong-answer review bank helps me learn and how to clear it." });
      if (id === "final-exam") onboardingPrompts.push({ icon: "◆", label: "What is the final exam?", text: "What is the TradeMind master certificate final exam, and how should I prepare?" });
      if (id === "scan" || id === "tour" || id === "timezone") onboardingPrompts.push({ icon: "◆", label: "What is my next step?", text: "What should I do next to get the most out of TradeMind?" });
    }
  }

  const prompts: { icon: string; label: string; text: string }[] = hasImage
    ? [
        { icon: "◈", label: "Grade this setup", text: "Grade the setup in the screenshot I just attached. Give bias, entry, stop, TP1, TP2, and R:R." },
        { icon: "⌖", label: "What timeframe is this?", text: "What symbol and timeframe is this chart? Confirm what you see before analyzing." },
        { icon: "⚠", label: "Where's invalidation?", text: "In the attached screenshot, where does this idea get invalidated and why?" },
      ]
    : mentionsGrade
    ? [
        { icon: "⚠", label: "What invalidates this?", text: `What would invalidate the current ${sym} idea and where should I move the stop if it partially runs?` },
        { icon: "⌖", label: "Where do I take profit?", text: `Walk me through the best places to scale out on this ${sym} trade and why.` },
        { icon: "◈", label: "Simpler explanation", text: "Explain that last analysis in simpler language, like I am new to trading." },
        { icon: "✎", label: "Show me on chart", text: `Show me the key levels for this ${sym} setup drawn on the chart.` },
      ]
    : [
        { icon: "◈", label: `Scan ${sym}`, text: `Give me a full multi-timeframe scan of ${sym} on the ${tf}. Grade it A+ to D with entry, stop, TP1, TP2, and rationale.` },
        { icon: "◆", label: `Trend on ${tf}`, text: `What is the current trend and structure on ${sym} ${tf}? Are we trending, ranging, or reversing?` },
        { icon: "◇", label: "Where is liquidity?", text: `Where are the nearest buy-side and sell-side liquidity pools on ${sym} right now?` },
        { icon: "✎", label: "Best strategy here", text: `Which of my strategies fits ${sym} on the ${tf} best right now, and why?` },
      ];

  const all = [...onboardingPrompts, ...prompts];

  return (
    <div className="mb-2 -mx-0.5 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      <span className="shrink-0 self-center text-[11px] font-medium text-muted-foreground pr-1">
        Ask
      </span>
      {all.map((p) => (
        <button
          key={p.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(p.text)}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/50 text-xs font-medium text-foreground/90 hover:bg-accent transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="text-muted-foreground text-[11px] leading-none">{p.icon}</span>
          {p.label}
        </button>
      ))}
    </div>
  );
}

