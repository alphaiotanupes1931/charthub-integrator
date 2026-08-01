import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  getBriefingState,
  updateBriefingPrefs,
  generateTelegramLinkCode,
  unlinkTelegram,
  sendBriefingNow,
  setDiscordWebhook,
  unlinkDiscord,
} from "@/lib/briefings.functions";
import { Copy, Send, Trash2 } from "lucide-react";
import { emitFirstWeekEvent } from "@/hooks/useFirstWeek";

export const Route = createFileRoute("/_app/briefings")({
  head: () => ({ meta: [{ title: "Briefings, TradeMind" }] }),
  component: BriefingsPage,
});

const TZ_OPTIONS = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Africa/Lagos", "Asia/Dubai",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

function BriefingsPage() {
  const qc = useQueryClient();
  const getState = useServerFn(getBriefingState);
  const state = useQuery({ queryKey: ["briefingState"], queryFn: () => getState() });

  const savePrefs = useMutation({
    mutationFn: useServerFn(updateBriefingPrefs),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["briefingState"] }); emitFirstWeekEvent("briefings-set"); },
  });
  const genLink = useMutation({
    mutationFn: useServerFn(generateTelegramLinkCode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["briefingState"] }); },
  });
  const unlink = useMutation({
    mutationFn: useServerFn(unlinkTelegram),
    onSuccess: () => { toast.success("Telegram unlinked"); qc.invalidateQueries({ queryKey: ["briefingState"] }); },
  });
  const sendNow = useMutation({
    mutationFn: useServerFn(sendBriefingNow),
    onSuccess: (r: any) => { toast.success(r.delivered ? "Sent to Telegram + in-app" : "Saved in-app (Telegram not linked)"); qc.invalidateQueries({ queryKey: ["briefingState"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDiscord = useMutation({
    mutationFn: useServerFn(setDiscordWebhook),
    onSuccess: () => { toast.success("Discord linked. Check your channel for the test message."); qc.invalidateQueries({ queryKey: ["briefingState"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const unlinkDisc = useMutation({
    mutationFn: useServerFn(unlinkDiscord),
    onSuccess: () => { toast.success("Discord unlinked"); qc.invalidateQueries({ queryKey: ["briefingState"] }); },
  });

  const [watchInput, setWatchInput] = useState("");
  const [discordInput, setDiscordInput] = useState("");

  if (state.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading briefings…</div>;
  const s = state.data;
  if (!s) return null;

  const prefs = s.prefs;
  const watchlist: string[] = prefs.watchlist ?? [];

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Daily briefings</h1>
        <p className="text-sm text-muted-foreground">Morning + evening report on your watchlist. In-app and Telegram.</p>
      </header>

      <section className="rounded-lg border border-border bg-card/40 p-4 space-y-4">
        <h2 className="font-semibold">Schedule</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Timezone</span>
            <select className="rounded border border-border bg-background px-2 py-1.5" defaultValue={prefs.timezone} onChange={(e) => savePrefs.mutate({ data: { timezone: e.target.value } })}>
              {TZ_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Morning hour (local)</span>
            <div className="flex items-center gap-2">
              <input type="checkbox" defaultChecked={prefs.morning_enabled} onChange={(e) => savePrefs.mutate({ data: { morning_enabled: e.target.checked } })} />
              <input type="number" min={0} max={23} defaultValue={prefs.morning_hour} onBlur={(e) => savePrefs.mutate({ data: { morning_hour: Number(e.target.value) } })} className="w-16 rounded border border-border bg-background px-2 py-1" />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Evening hour (local)</span>
            <div className="flex items-center gap-2">
              <input type="checkbox" defaultChecked={prefs.evening_enabled} onChange={(e) => savePrefs.mutate({ data: { evening_enabled: e.target.checked } })} />
              <input type="number" min={0} max={23} defaultValue={prefs.evening_hour} onBlur={(e) => savePrefs.mutate({ data: { evening_hour: Number(e.target.value) } })} className="w-16 rounded border border-border bg-background px-2 py-1" />
            </div>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
        <h2 className="font-semibold">Watchlist</h2>
        <div className="flex flex-wrap gap-2">
          {watchlist.map((w) => (
            <span key={w} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs">
              {w}
              <button
                onClick={() => savePrefs.mutate({ data: { watchlist: watchlist.filter((x) => x !== w) } })}
                className="text-muted-foreground hover:text-destructive"
              ><Trash2 className="size-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input value={watchInput} onChange={(e) => setWatchInput(e.target.value)} placeholder="Add symbol e.g. XAU/USD" className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm" />
          <button
            onClick={() => {
              const v = watchInput.trim().toUpperCase();
              if (!v || watchlist.includes(v)) return;
              savePrefs.mutate({ data: { watchlist: [...watchlist, v] } });
              setWatchInput("");
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >Add</button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card/40 p-4 space-y-2">
        <h2 className="font-semibold">Delivery channels</h2>
        <p className="text-sm text-muted-foreground">
          Telegram delivery has its own page now:{" "}
          <Link to="/telegram" className="underline">
            {prefs.telegram_chat_id ? "Telegram (linked)" : "set up Telegram"}
          </Link>
          . The session news read and full economic calendar live on <Link to="/news" className="underline">News</Link>.
        </p>
      </section>


      <section className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
        <h2 className="font-semibold">Discord</h2>
        <p className="text-xs text-muted-foreground">
          Get briefings, A/A+ signals, and kill-switch alerts posted to a Discord channel. In your Discord server go to
          <span className="mx-1 font-medium text-foreground">Server Settings → Integrations → Webhooks → New Webhook</span>,
          pick a channel, then paste the webhook URL below.
        </p>
        {(prefs as any).discord_webhook_url ? (
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm truncate">
              Linked · <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{String((prefs as any).discord_webhook_url).replace(/(\/webhooks\/\d+\/).+/, "$1•••")}</code>
            </div>
            <button onClick={() => unlinkDisc.mutate({})} className="rounded-md border border-border px-3 py-1.5 text-sm">Unlink</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={discordInput}
              onChange={(e) => setDiscordInput(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm font-mono"
            />
            <button
              onClick={() => {
                const v = discordInput.trim();
                if (!v) return;
                saveDiscord.mutate({ data: { webhook_url: v } });
              }}
              disabled={saveDiscord.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saveDiscord.isPending ? "Linking…" : "Link Discord"}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">History</h2>
          <button onClick={() => sendNow.mutate({ data: { kind: "ad_hoc" } })} disabled={sendNow.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            <Send className="size-4" /> Send me a briefing now
          </button>
        </div>
        {s.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No briefings yet.</p>
        ) : (
          <ul className="space-y-3">
            {s.history.map((b: any) => (
              <li key={b.id} className="rounded border border-border p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="uppercase">{b.kind}</span>
                  <span>{new Date(b.sent_at).toLocaleString()}</span>
                </div>
                <div className="font-medium mt-1">{b.title}</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground mt-2">{b.body}</pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
