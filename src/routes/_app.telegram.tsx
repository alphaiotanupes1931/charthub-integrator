import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Send } from "lucide-react";
import {
  getBriefingState,
  generateTelegramLinkCode,
  unlinkTelegram,
  sendBriefingNow,
} from "@/lib/briefings.functions";

export const Route = createFileRoute("/_app/telegram")({
  head: () => ({
    meta: [
      { title: "Telegram delivery, TradeMind" },
      {
        name: "description",
        content:
          "Link your Telegram account so TradeMind sends morning briefings, evening reports and high conviction signals straight to your chat.",
      },
      { property: "og:title", content: "Telegram delivery, TradeMind" },
      {
        property: "og:description",
        content: "Link Telegram to receive TradeMind briefings and signals in your chat.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelegramPage,
});

function TelegramPage() {
  const qc = useQueryClient();
  const getState = useServerFn(getBriefingState);
  const state = useQuery({ queryKey: ["briefingState"], queryFn: () => getState() });

  const genLink = useMutation({
    mutationFn: useServerFn(generateTelegramLinkCode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["briefingState"] }),
  });
  const unlink = useMutation({
    mutationFn: useServerFn(unlinkTelegram),
    onSuccess: () => {
      toast.success("Telegram unlinked");
      qc.invalidateQueries({ queryKey: ["briefingState"] });
    },
  });
  const sendNow = useMutation({
    mutationFn: useServerFn(sendBriefingNow),
    onSuccess: (r: { delivered?: boolean }) =>
      toast.success(r.delivered ? "Sent to Telegram" : "Saved in app. Telegram is not linked yet."),
    onError: (e: Error) => toast.error(e.message),
  });

  if (state.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading Telegram settings...</div>;
  const prefs = state.data?.prefs;
  if (!prefs) return null;

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Telegram</h1>
        <p className="text-sm text-muted-foreground">
          Get your morning briefing, evening report and high conviction signals in a Telegram chat.
        </p>
      </header>

      <section className="rounded-md border border-border bg-card/40 p-4 space-y-3">
        <h2 className="font-semibold">Connection</h2>
        {prefs.telegram_chat_id ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm">
              Linked to chat{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {prefs.telegram_chat_id}
              </code>
            </div>
            <button
              onClick={() => unlink.mutate({})}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Unlink
            </button>
          </div>
        ) : prefs.telegram_link_code ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Open Telegram, find the TradeMind bot, and send this message:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 text-sm">
                /start {prefs.telegram_link_code}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`/start ${prefs.telegram_link_code}`);
                  toast.success("Copied");
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Copy className="size-3.5" /> Copy
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Refresh this page once you have sent it.
            </p>
          </div>
        ) : (
          <button
            onClick={() => genLink.mutate({})}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Generate link code
          </button>
        )}
      </section>

      <section className="rounded-md border border-border bg-card/40 p-4 space-y-3">
        <h2 className="font-semibold">Test delivery</h2>
        <p className="text-sm text-muted-foreground">
          Sends a briefing right now using your watchlist and today's economic calendar.
        </p>
        <button
          onClick={() => sendNow.mutate({ data: { kind: "ad_hoc" } })}
          disabled={sendNow.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          <Send className="size-4" /> {sendNow.isPending ? "Sending..." : "Send a test briefing"}
        </button>
      </section>

      <p className="text-sm text-muted-foreground">
        Schedule, timezone and watchlist live in{" "}
        <Link to="/briefings" className="underline">
          Briefings
        </Link>
        . The session news read lives in{" "}
        <Link to="/news" className="underline">
          News
        </Link>
        .
      </p>
    </div>
  );
}
