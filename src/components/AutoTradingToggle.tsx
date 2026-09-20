// Home-page Manual / Auto switch for auto trading. Auto means: when a scan comes
// back at or above the chosen grade, the trader is asked whether to place it.
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Check, ChevronDown, ShieldAlert, X } from "lucide-react";
import { getAutoTradeContext, setAutoTradingMode } from "@/lib/auto-trade.functions";
import type { AutopilotSettings } from "@/lib/autopilot.shared";

export const AUTO_TRADE_CONTEXT_KEY = ["autoTrade", "context"] as const;

export function AutoTradingToggle({ className = "" }: { className?: string }) {
  const qc = useQueryClient();
  const loadContext = useServerFn(getAutoTradeContext);
  const setMode = useServerFn(setAutoTradingMode);
  const [notice, setNotice] = useState<null | "no-broker" | "live-consent">(null);
  const [open, setOpen] = useState(false);
  const [pendingGrade, setPendingGrade] = useState<AutopilotSettings["minGrade"] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const ctx = useQuery({
    queryKey: AUTO_TRADE_CONTEXT_KEY,
    queryFn: () => loadContext(),
    retry: false,
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (input: { mode: "manual" | "auto"; minGrade?: AutopilotSettings["minGrade"]; acknowledgeLive?: boolean }) =>
      setMode({ data: input }),
    onSuccess: (_res, input) => {
      qc.invalidateQueries({ queryKey: AUTO_TRADE_CONTEXT_KEY });
      toast.success(
        input.mode === "auto"
          ? "Auto Trading is on. Qualifying setups are placed at your broker automatically, even while the app is closed."
          : "Auto Trading is off. Nothing will be placed for you.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mode = ctx.data?.settings?.mode ?? "manual";
  const minGrade = ctx.data?.settings?.minGrade ?? "A";
  const connected = ctx.data?.broker?.connected ?? false;
  const auto = mode === "auto";
  const unavailable = ctx.isError;

  const enableAtGrade = (grade: AutopilotSettings["minGrade"]) => {
    setOpen(false);
    if (unavailable) {
      toast.error("Auto Trading is part of the Elite plan.");
      return;
    }
    setPendingGrade(grade);
    if (!connected) {
      setNotice("no-broker");
      return;
    }
    if (!ctx.data?.settings?.liveAcknowledged) {
      setNotice("live-consent");
      return;
    }
    save.mutate({ mode: "auto", minGrade: grade });
  };

  const turnOff = () => {
    setOpen(false);
    setPendingGrade(null);
    save.mutate({ mode: "manual" });
  };

  return (
    <>
       <div ref={menuRef} className={`relative inline-flex items-center ${className}`}>
        <button
          type="button"
           onClick={() => setOpen((value) => !value)}
          disabled={save.isPending || ctx.isLoading}
           title="Choose the minimum grade for Auto Trading"
           aria-haspopup="menu"
           aria-expanded={open}
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
            auto
              ? "border-emerald-600/50 bg-emerald-600/10 text-emerald-400"
              : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bot className="h-3 w-3" />
          <span>Auto Trading</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${auto ? "bg-emerald-600/20" : "bg-accent/60"}`}>
             {auto ? `${minGrade}+` : "Off"}
          </span>
           <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
         {open && (
           <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-md border border-border/60 bg-card p-1.5">
             <div className="px-2 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground">Minimum signal grade</div>
             {([
               { grade: "A+" as const, label: "A+ only" },
               { grade: "A" as const, label: "A and better" },
               { grade: "B" as const, label: "B and better" },
             ]).map((option) => (
               <button
                 key={option.grade}
                 type="button"
                 role="menuitemradio"
                 aria-checked={auto && minGrade === option.grade}
                 onClick={() => enableAtGrade(option.grade)}
                 className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs font-medium text-foreground hover:bg-accent/60"
               >
                 <Check className={`h-3.5 w-3.5 ${auto && minGrade === option.grade ? "text-primary" : "text-transparent"}`} />
                 {option.label}
               </button>
             ))}
             <div className="my-1 border-t border-border/60" />
             <button
               type="button"
               role="menuitemradio"
               aria-checked={!auto}
               onClick={turnOff}
               className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
             >
               <Check className={`h-3.5 w-3.5 ${!auto ? "text-primary" : "text-transparent"}`} />
               Off
             </button>
           </div>
        )}
      </div>

      {notice && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                {notice === "no-broker" ? "No broker connected yet" : "Before Auto Trading is switched on"}
              </div>
              <button type="button" onClick={() => setNotice(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            {notice === "no-broker" ? (
              <>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Auto Trading places real orders at your own broker account, so a broker has to be connected first.
                  Connect one, then switch this back to Auto and it will work.
                </p>
                <div className="mt-4 flex gap-2">
                  <Link
                    to="/broker"
                    onClick={() => setNotice(null)}
                    className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    Connect a broker
                  </Link>
                  <button
                    type="button"
                    onClick={() => setNotice(null)}
                    className="rounded-xl border border-border/60 px-3 py-1.5 text-xs"
                  >
                    Not now
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  You are allowing real orders to be sent to your own broker account automatically, with no further
                  confirmation, including while the app is closed. Every order is sent with its stop loss and target
                  already attached. Ongoing management afterwards (stop to break-even, partials, trailing) applies to
                  OANDA-routed trades opened by Auto Trading from now on — positions you opened yourself, and trades
                  opened before this setting existed, are never touched.
                </p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  This is opt-in automation of your own strategy, executed with your own broker credentials under your
                  broker&apos;s third-party API terms. It is not investment advice, a managed account, or a
                  recommendation, and nothing here is personalised to your circumstances. TradeMind is not a broker,
                  adviser, or money manager, no outcome is guaranteed, and you keep full responsibility for every
                  order. Switch back to Manual at any time.
                </p>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                       save.mutate({ mode: "auto", minGrade: pendingGrade ?? minGrade, acknowledgeLive: true });
                       setPendingGrade(null);
                      setNotice(null);
                    }}
                    className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    I understand, turn it on
                  </button>
                  <button
                    type="button"
                    onClick={() => setNotice(null)}
                    className="rounded-xl border border-border/60 px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
