import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  Trash2,
  X,
  Activity,
  TrendingUp,
  DollarSign,
  Info,
  Radar,
  type LucideIcon,
} from "lucide-react";
import {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  clearReadNotifications,
  createTestNotification,
  type NotificationRow,
} from "@/lib/notifications.functions";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `just now`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

type KindStyle = {
  Icon: LucideIcon;
  ring: string;
  bg: string;
  fg: string;
  label: string;
};

function kindStyle(kind: string): KindStyle {
  switch (kind) {
    case "signal":
      return { Icon: TrendingUp, ring: "ring-bull/30", bg: "bg-bull/10", fg: "text-bull", label: "Signal" };
    case "scanner":
      return { Icon: Radar, ring: "ring-sky-500/30", bg: "bg-sky-500/10", fg: "text-sky-500", label: "Scanner" };
    case "alert":
      return { Icon: BellRing, ring: "ring-amber-500/30", bg: "bg-amber-500/10", fg: "text-amber-500", label: "Alert" };
    case "price":
      return { Icon: DollarSign, ring: "ring-amber-500/30", bg: "bg-amber-500/10", fg: "text-amber-500", label: "Price" };
    case "trade":
      return { Icon: Activity, ring: "ring-primary/30", bg: "bg-primary/10", fg: "text-primary", label: "Trade" };
    case "system":
      return { Icon: Info, ring: "ring-rose-500/30", bg: "bg-rose-500/10", fg: "text-rose-500", label: "System" };
    default:
      return { Icon: Info, ring: "ring-border", bg: "bg-muted", fg: "text-muted-foreground", label: "Notice" };
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const qc = useQueryClient();

  const listFn = useServerFn(listMyNotifications);
  const markReadFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);
  const deleteFn = useServerFn(deleteNotification);
  const clearReadFn = useServerFn(clearReadNotifications);
  const createTestFn = useServerFn(createTestNotification);

  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) setHasSession(!!data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setHasSession(!!session);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
    staleTime: 5_000,
    enabled: hasSession,
  });


  const rows: NotificationRow[] = data?.rows ?? [];
  const unread = data?.unread ?? 0;

  // Browser Notification + beep for newly-arrived alerts.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (!rows.length) return;
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      rows.forEach((r) => seenIdsRef.current.add(r.id));
      return;
    }
    const fresh = rows.filter((r) => !seenIdsRef.current.has(r.id) && !r.read_at);
    if (fresh.length === 0) return;
    fresh.forEach((r) => seenIdsRef.current.add(r.id));

    // Beep
    try {
      const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (Ctx) {
        const ctx = new Ctx();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        g.gain.value = 0.05;
        o.connect(g); g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.18);
        setTimeout(() => ctx.close().catch(() => {}), 400);
      }
    } catch { /* ignore */ }

    // Desktop notification
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      fresh.slice(0, 3).forEach((r) => {
        try {
          const n = new Notification(r.title, { body: r.body ?? undefined, tag: r.id });
          if (r.url) n.onclick = () => { window.focus(); window.location.href = r.url!; };
        } catch { /* ignore */ }
      });
    }
  }, [rows]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["notifications"] });


  const mRead = useMutation({ mutationFn: (id: string) => markReadFn({ data: { id } }), onSuccess: invalidate });
  const mAll = useMutation({ mutationFn: () => markAllFn(), onSuccess: invalidate });
  const mDel = useMutation({ mutationFn: (id: string) => deleteFn({ data: { id } }), onSuccess: invalidate });
  const mClr = useMutation({ mutationFn: () => clearReadFn(), onSuccess: invalidate });
  const mTest = useMutation({
    mutationFn: () =>
      createTestFn({
        data: {
          kind: "signal",
          title: "Test notification",
          body: "This is a sample alert from the inbox. Everything is wired up.",
        },
      }),
    onSuccess: invalidate,
  });

  const navigate = useNavigate();

  const visibleRows = useMemo(() => {
    return filter === "unread" ? rows.filter((r) => !r.read_at) : rows;
  }, [rows, filter]);

  const hasRead = useMemo(() => rows.some((r) => r.read_at), [rows]);

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
            Notification.requestPermission().catch(() => {});
          }
        }}
        className="relative h-9 w-9 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-primary/40 transition shrink-0"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none flex items-center justify-center ring-2 ring-background">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Notifications">
          {/* Translucent backdrop keeps the page visible behind the overlay. */}
          <div className="absolute inset-0 bg-background/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside
            className="absolute inset-x-2 bottom-2 top-16 sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-14 sm:w-[400px] sm:max-h-[calc(100vh-5rem)] bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 px-4 py-3 border-b border-border">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold leading-tight">Notifications</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Filter tabs */}
              <div className="mt-3 flex items-center gap-4 text-xs">
                {(["all", "unread"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`relative -mb-3 pb-2 font-medium capitalize transition ${
                      filter === f
                        ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f}
                    {f === "unread" && unread > 0 && <span className="ml-1 text-muted-foreground">{unread}</span>}
                  </button>
                ))}
              </div>
            </div>


            {/* Action bar */}
            <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border/60 text-xs bg-card">
              <button
                onClick={() => mAll.mutate()}
                disabled={unread === 0 || mAll.isPending}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
              <button
                onClick={() => mClr.mutate()}
                disabled={!hasRead || mClr.isPending}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear read
              </button>
              <div className="flex-1" />
              <button
                onClick={() => mTest.mutate()}
                disabled={mTest.isPending}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted transition"
                title="Create a test notification"
              >
                Test
              </button>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {visibleRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 py-16 text-muted-foreground">
                  <div className="h-14 w-14 rounded-full bg-muted/60 flex items-center justify-center mb-4">
                    <Bell className="h-6 w-6 opacity-50" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {filter === "unread" ? "No unread notifications" : "No notifications yet"}
                  </p>
                  <p className="text-xs mt-1.5 max-w-[260px]">
                    Signals, price alerts, and scanner hits will show up here as they happen.
                  </p>
                </div>
              ) : (
                <ul className="p-2 space-y-1.5">
                  {visibleRows.map((n) => {
                    const isUnread = !n.read_at;
                    const style = kindStyle(n.kind);
                    const { Icon } = style;
                    return (
                      <li
                        key={n.id}
                        className={`group relative rounded-lg border transition-all ${
                          isUnread
                            ? "bg-primary/[0.04] border-primary/20 hover:border-primary/40 hover:bg-primary/[0.07]"
                            : "bg-transparent border-transparent hover:bg-muted/40 hover:border-border/60"
                        }`}
                      >
                        <div className="flex items-start gap-3 p-3">
                          <div className={`shrink-0 h-9 w-9 rounded-lg ring-1 ${style.ring} ${style.bg} flex items-center justify-center`}>
                            <Icon className={`h-4 w-4 ${style.fg}`} />
                          </div>
                          <button
                            className="flex-1 text-left min-w-0"
                            onClick={() => {
                              if (isUnread) mRead.mutate(n.id);
                              if (n.url) {
                                setOpen(false);
                                if (n.url.startsWith("/")) navigate({ to: n.url });
                                else window.open(n.url, "_blank", "noopener");
                              }
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] uppercase tracking-wide font-semibold ${style.fg}`}>
                                {style.label}
                              </span>
                              {isUnread && (
                                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Unread" />
                              )}
                              <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                                {timeAgo(n.created_at)}
                              </span>
                            </div>
                            <p className={`mt-1 text-sm leading-snug ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
                              {n.title}
                            </p>
                            {n.body && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{n.body}</p>
                            )}
                          </button>
                          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            {isUnread && (
                              <button
                                onClick={() => mRead.mutate(n.id)}
                                className="h-7 w-7 rounded-md hover:bg-background border border-transparent hover:border-border flex items-center justify-center text-muted-foreground hover:text-foreground transition"
                                title="Mark read"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => mDel.mutate(n.id)}
                              className="h-7 w-7 rounded-md hover:bg-background border border-transparent hover:border-destructive/30 flex items-center justify-center text-muted-foreground hover:text-destructive transition"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
