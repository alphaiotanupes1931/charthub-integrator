import { createFileRoute } from "@tanstack/react-router";
import { Brain } from "lucide-react";

export const Route = createFileRoute("/_app/chat/")({
  component: ChatEmpty,
});

function ChatEmpty() {
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
      <p className="text-xs text-muted-foreground mt-6">
        Start a new conversation from the left, or pick one to continue.
      </p>
    </div>
  );
}
