import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, CheckCheck, Trash2, X, Sparkles } from "lucide-react";
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
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function kindDot(kind: string): string {
  switch (kind) {
    case "signal":
    case "scanner":
      return "bg-emerald-500";
    case "alert":
    case "price":
      return "bg-amber-500";
    case "trade":
      return "bg-sky-500";
    case "system":
      return "bg-rose-500";
    default:
      return "bg-muted-foreground";
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
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

  const grouped = useMemo(() => {
    const unreadRows = rows.filter((r) => !r.read_at);
    const readRows = rows.filter((r) => r.read_at);
    return { unreadRows, readRows };
  }, [rows]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative h-9 w-9 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        title="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Notifications">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute right-0 top-0 h-full w-full sm:w-[420px] bg-card border-l border-border shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Notifications</h2>
                {unread > 0 && (
                  <span className="text-[11px] text-muted-foreground">{unread} unread</span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 px-3 py-2 border-b border-border/60 text-xs">
              <button
                onClick={() => mAll.mutate()}
                disabled={unread === 0 || mAll.isPending}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-muted disabled:opacity-40"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
              <button
                onClick={() => mClr.mutate()}
                disabled={grouped.readRows.length === 0 || mClr.isPending}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md hover:bg-muted disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear read
              </button>
              <div className="flex-1" />
              <button
                onClick={() => mTest.mutate()}
                disabled={mTest.isPending}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-muted-foreground hover:bg-muted"
                title="Create a test notification"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Test
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12 text-muted-foreground">
                  <Bell className="h-8 w-8 opacity-40 mb-3" />
                  <p className="text-sm font-medium">No notifications yet</p>
                  <p className="text-xs mt-1">
                    Signals, price alerts, and scanner hits will land here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {rows.map((n) => {
                    const isUnread = !n.read_at;
                    return (
                      <li
                        key={n.id}
                        className={`group px-4 py-3 hover:bg-muted/40 ${isUnread ? "bg-muted/20" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${kindDot(n.kind)}`} />
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
                            <div className="flex items-baseline gap-2">
                              <p className={`text-sm truncate ${isUnread ? "font-semibold" : "font-medium text-muted-foreground"}`}>
                                {n.title}
                              </p>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {timeAgo(n.created_at)}
                              </span>
                            </div>
                            {n.body && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                            )}
                          </button>
                          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {isUnread && (
                              <button
                                onClick={() => mRead.mutate(n.id)}
                                className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground"
                                title="Mark read"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => mDel.mutate(n.id)}
                              className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground"
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
        </div>
      )}
    </>
  );
}
