import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import {
  getBriefingState,
  updateBriefingPrefs,
  setDiscordWebhook,
  unlinkDiscord,
  sendBriefingNow,
} from "@/lib/briefings.functions";
import { MessageSquare, Copy, Trash2, Send, ExternalLink, Check } from "lucide-react";

export const Route = createFileRoute("/_app/discord")({
  head: () => ({
    meta: [
      { title: "Discord Notifications, TradeMind" },
      { name: "description", content: "Get morning + evening briefings, A/A+ scan signals, price alerts, and paper-trade kill-switch alerts posted to your Discord channel." },
    ],
  }),
  component: DiscordPage,
});

const TZ_OPTIONS = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Africa/Lagos", "Asia/Dubai",
  "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

function DiscordPage() {
  const qc = useQueryClient();
  const getState = useServerFn(getBriefingState);
  const state = useQuery({ queryKey: ["briefingState"], queryFn: () => getState() });

  const savePrefs = useMutation({
    mutationFn: useServerFn(updateBriefingPrefs),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["briefingState"] }); },
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
  const sendNow = useMutation({
    mutationFn: useServerFn(sendBriefingNow),
    onSuccess: (r: { delivered: boolean }) => {
      toast.success(r.delivered ? "Test briefing sent" : "Saved in-app (no Discord/Telegram linked)");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [watchInput, setWatchInput] = useState("");
  const [discordInput, setDiscordInput] = useState("");

  if (state.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading Discord settings…</div>;
  const s = state.data;
  if (!s) return null;
  const prefs = s.prefs as {
    timezone: string;
    morning_enabled: boolean; morning_hour: number;
    evening_enabled: boolean; evening_hour: number;
    watchlist: string[] | null;
    discord_webhook_url: string | null;
  };
  const watchlist: string[] = prefs.watchlist ?? [];
  const linked = Boolean(prefs.discord_webhook_url);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Discord Notifications"
        description="Pipe your morning + evening briefings, A/A+ scan signals, price alerts, and paper-trade kill-switch alerts into a Discord channel."
        icon={<MessageSquare className="h-6 w-6 text-primary" />}
      />

      {/* Step-by-step setup */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-1">How to set it up (2 minutes)</h2>
        <p className="text-xs text-muted-foreground mb-4">One-time setup, then everything below runs automatically.</p>
        <ol className="space-y-3 text-sm">
          <Step n={1} title="Open your Discord server">Desktop or web works. Pick the server you want notifications posted to.</Step>
          <Step n={2} title="Server Settings → Integrations → Webhooks">
            Click your server name at the top-left, choose <span className="font-medium">Server Settings</span>, then <span className="font-medium">Integrations</span>, then <span className="font-medium">Webhooks</span>.
          </Step>
          <Step n={3} title="New Webhook → pick a channel">
            Name it something like "TradeMind" and select the channel where alerts should appear (e.g. <code className="text-[11px] bg-muted px-1 py-0.5 rounded">#signals</code>).
          </Step>
          <Step n={4} title="Copy Webhook URL">
            Click <span className="font-medium">Copy Webhook URL</span>. It looks like <code className="text-[11px] bg-muted px-1 py-0.5 rounded">https://discord.com/api/webhooks/…</code>
          </Step>
          <Step n={5} title="Paste it below and click Link">
            We'll send a test message to that channel so you know it worked.
          </Step>
        </ol>
        <a
          href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
          target="_blank" rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          Discord's official guide <ExternalLink className="h-3 w-3" />
        </a>
      </section>

      {/* Link/unlink */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="font-semibold">Your webhook</h2>
        {linked ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 min-w-0">
              <Check className="h-4 w-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">Linked and active</div>
                <code className="text-[11px] text-muted-foreground truncate block">
                  {String(prefs.discord_webhook_url).replace(/(\/webhooks\/\d+\/).+/, "$1•••")}
                </code>
              </div>
            </div>
            <button onClick={() => unlinkDisc.mutate({})} className="rounded-md border border-border px-3 py-1.5 text-sm shrink-0">Unlink</button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-stretch gap-2">
            <input
              value={discordInput}
              onChange={(e) => setDiscordInput(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              className="flex-1 rounded border border-border bg-background px-2 py-2 text-sm font-mono"
            />
            <button
              onClick={() => {
                const v = discordInput.trim();
                if (!v) { toast.error("Paste your webhook URL first"); return; }
                saveDiscord.mutate({ data: { webhook_url: v } });
              }}
              disabled={saveDiscord.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saveDiscord.isPending ? "Linking…" : "Link Discord"}
            </button>
          </div>
        )}
      </section>

      {/* What you'll receive */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-3">What gets sent to Discord</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <FeatureCard title="Morning briefing" body="Your watchlist prices, 24h change, and 20-bar range at your morning hour." />
          <FeatureCard title="Evening report" body="End-of-day recap with a nudge to log trades and your mental state." />
          <FeatureCard title="A / A+ scan signals" body="When the AI Signal Engine finds a high-conviction setup, it posts entry, stop, TP1, and R:R." />
          <FeatureCard title="Price alerts" body="Fires when a symbol crosses a target you set on the Alerts page." />
          <FeatureCard title="Paper trade kill-switch" body="If your paper account drops 10% from peak, the auto-liquidation event is posted." />
          <FeatureCard title="Manual test" body="Use the button below to send a test briefing to your Discord channel right now." />
        </div>
      </section>

      {/* Schedule */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="font-semibold">Timing (your local time)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Timezone</span>
            <select
              className="rounded border border-border bg-background px-2 py-2"
              defaultValue={prefs.timezone}
              onChange={(e) => savePrefs.mutate({ data: { timezone: e.target.value } })}
            >
              {TZ_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Morning briefing</span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                defaultChecked={prefs.morning_enabled}
                onChange={(e) => savePrefs.mutate({ data: { morning_enabled: e.target.checked } })}
              />
              <input
                type="number" min={0} max={23}
                defaultValue={prefs.morning_hour}
                onBlur={(e) => savePrefs.mutate({ data: { morning_hour: Number(e.target.value) } })}
                className="w-20 rounded border border-border bg-background px-2 py-1.5"
              />
              <span className="text-xs text-muted-foreground">hour (0–23)</span>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Evening report</span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                defaultChecked={prefs.evening_enabled}
                onChange={(e) => savePrefs.mutate({ data: { evening_enabled: e.target.checked } })}
              />
              <input
                type="number" min={0} max={23}
                defaultValue={prefs.evening_hour}
                onBlur={(e) => savePrefs.mutate({ data: { evening_hour: Number(e.target.value) } })}
                className="w-20 rounded border border-border bg-background px-2 py-1.5"
              />
              <span className="text-xs text-muted-foreground">hour (0–23)</span>
            </div>
          </label>
        </div>
      </section>

      {/* Watchlist */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="font-semibold">Watchlist</h2>
        <p className="text-xs text-muted-foreground">
          These are the symbols included in your morning and evening posts. Add any instrument you're tracking, e.g. <code className="text-[11px] bg-muted px-1 py-0.5 rounded">XAU/USD</code>, <code className="text-[11px] bg-muted px-1 py-0.5 rounded">EUR/USD</code>, <code className="text-[11px] bg-muted px-1 py-0.5 rounded">^GSPC</code>, <code className="text-[11px] bg-muted px-1 py-0.5 rounded">^NDX</code>, <code className="text-[11px] bg-muted px-1 py-0.5 rounded">BTC/USD</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          {watchlist.length === 0 && (
            <span className="text-xs text-muted-foreground italic">No symbols yet. Add one below.</span>
          )}
          {watchlist.map((w) => (
            <span key={w} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium">
              {w}
              <button
                onClick={() => savePrefs.mutate({ data: { watchlist: watchlist.filter((x) => x !== w) } })}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${w}`}
              ><Trash2 className="size-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={watchInput}
            onChange={(e) => setWatchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = watchInput.trim().toUpperCase();
                if (!v || watchlist.includes(v)) return;
                savePrefs.mutate({ data: { watchlist: [...watchlist, v] } });
                setWatchInput("");
              }
            }}
            placeholder="Add symbol (e.g. XAU/USD)"
            className="flex-1 rounded border border-border bg-background px-2 py-2 text-sm"
          />
          <button
            onClick={() => {
              const v = watchInput.trim().toUpperCase();
              if (!v || watchlist.includes(v)) return;
              savePrefs.mutate({ data: { watchlist: [...watchlist, v] } });
              setWatchInput("");
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >Add</button>
        </div>
      </section>

      {/* Test */}
      <section className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Send a test briefing now</h2>
          <p className="text-xs text-muted-foreground">Fires an ad-hoc briefing to your linked Discord channel (and Telegram if linked).</p>
        </div>
        <button
          onClick={() => sendNow.mutate({ data: { kind: "ad_hoc" } })}
          disabled={sendNow.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Send className="size-4" /> {sendNow.isPending ? "Sending…" : "Send test"}
        </button>
      </section>

      {/* Copy referral tag helper */}
      <p className="text-[11px] text-muted-foreground text-center">
        Prefer Telegram? You can link that on the <a href="/briefings" className="underline hover:text-foreground">Briefings page</a>.
        <button
          onClick={() => { navigator.clipboard.writeText("https://trademindaicoach.com/discord"); toast.success("Link copied"); }}
          className="ml-2 inline-flex items-center gap-1 hover:text-foreground"
        ><Copy className="size-3" /> Share this page</button>
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-muted-foreground text-[13px] leading-relaxed">{children}</div>
      </div>
    </li>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="font-semibold text-sm mb-1">{title}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
