import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Plus } from "lucide-react";
import { useState } from "react";
import { createChatThread } from "@/lib/chat.functions";

export const Route = createFileRoute("/_app/chat/")({
  component: ChatEmpty,
});

function ChatEmpty() {
  const navigate = useNavigate();
  const createFn = useServerFn(createChatThread);
  const [busy, setBusy] = useState(false);

  const startNew = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const t = await createFn({ data: {} });
      if (t) navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
      <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
        <Brain className="h-7 w-7 text-primary" />
      </div>
      <h1 className="font-display text-2xl font-semibold mb-2">Talk to your AI coach</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        Ask about your setups, win rate, weaknesses, or what a term means. Your coach reads your
        journal in real time and remembers every conversation.
      </p>
      <button
        onClick={startNew}
        disabled={busy}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        <Plus className="h-4 w-4" /> {busy ? "Starting…" : "Start new conversation"}
      </button>
      <p className="text-xs text-muted-foreground mt-4">
        Or pick an existing conversation from the list.
      </p>
    </div>
  );
}
