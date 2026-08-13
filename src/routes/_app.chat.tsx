import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listChatThreads, createChatThread, deleteChatThread } from "@/lib/chat.functions";
import { clearLastThreadId } from "@/lib/chat-client";

export const Route = createFileRoute("/_app/chat")({
  head: () => ({ meta: [{ title: "AI Coach Chat, TradeMind" }] }),
  component: ChatLayout,
});

type Thread = { id: string; title: string; updated_at: string };

function ChatLayout() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { threadId?: string };

  const listFn = useServerFn(listChatThreads);
  const createFn = useServerFn(createChatThread);
  const delFn = useServerFn(deleteChatThread);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listFn();
      setThreads(rows as Thread[]);
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleNew = useCallback(async () => {
    const t = await createFn({ data: {} });
    if (t) {
      setThreads((prev) => [{ id: t.id, title: t.title, updated_at: t.updated_at }, ...prev]);
      navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
    }
  }, [createFn, navigate]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this TradeMind conversation?")) return;
    try {
      await delFn({ data: { threadId: id } });
      clearLastThreadId(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (params.threadId === id) navigate({ to: "/chat" });
    } catch {
      toast.error("Could not delete conversation");
    }
  }, [delFn, navigate, params.threadId]);

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Thread sidebar */}
      <aside className="w-72 shrink-0 border-r border-border/60 bg-card/40 flex flex-col">
        <div className="p-3 border-b border-border/60">
          <Button onClick={handleNew} className="w-full justify-start gap-2" variant="default">
            <Plus className="h-4 w-4" /> New conversation
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading && <div className="text-xs text-muted-foreground p-3">Loading...</div>}
          {!loading && threads.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 italic">
              No conversations yet. Start one above.
            </div>
          )}
          {threads.map((t) => {
            const active = params.threadId === t.id;
            return (
              <div
                key={t.id}
                className={`group flex items-center gap-2 rounded-xl px-2 py-2 text-sm cursor-pointer transition ${
                  active ? "bg-primary/15 text-primary" : "hover:bg-accent/40 text-foreground/80"
                }`}
              >
                <Link
                  to="/chat/$threadId"
                  params={{ threadId: t.id }}
                  className="flex-1 min-w-0 flex items-center gap-2"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{t.title}</span>
                </Link>
                <button
                  onClick={(e) => handleDelete(t.id, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"
                  aria-label="Delete conversation"
                  title="Delete conversation"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Active chat */}
      <main className="flex-1 min-w-0 flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
