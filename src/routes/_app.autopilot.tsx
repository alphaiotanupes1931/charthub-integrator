import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Bot, Check, X, ShieldAlert, Clock } from "lucide-react";
import {
  DEFAULT_AUTOPILOT_SETTINGS,
  MODE_COPY,
  type AutopilotMode,
  type AutopilotSettings,
} from "@/lib/autopilot.shared";
import {
  getAutopilotSettings,
  listAutopilotProposals,
  updateAutopilotSettings,
  decideAutopilotProposal,
} from "@/lib/autopilot.functions";

export const Route = createFileRoute("/_app/autopilot")({
  head: () => ({
    meta: [
      { title: "Autopilot, TradeMind" },
      {
        name: "description",
        content:
          "Set how much the AI coach is allowed to do on its own: propose only, wait for your approval, or execute inside fixed risk rails.",
      },
      { property: "og:title", content: "Autopilot, TradeMind" },
      {
        property: "og:description",
        content: "Control AI trade automation with explicit risk rails and an auditable decision feed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AutopilotPage,
});

const SYMBOL_CHOICES = ["XAU/USD", "XAG/USD", "EUR/USD", "GBP/USD", "USD/JPY", "NAS100", "SPX500", "US30", "WTI OIL"];

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "filled" || status === "approved"
      ? "border-emerald-600/40 text-emerald-400"
      : status === "pending"
        ? "border-amber-600/40 text-amber-400"
        : status === "blocked" || status === "failed"
          ? "border-red-600/40 text-red-400"
          : "border-border text-muted-foreground";
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[11px] uppercase tracking-wide ${tone}`}>{status}</span>
  );
}

function AutopilotPage() {
  const qc = useQueryClient();
  const loadSettings = useServerFn(getAutopilotSettings);
  const loadProposals = useServerFn(listAutopilotProposals);
  const saveSettings = useServerFn(updateAutopilotSettings);
  const decide = useServerFn(decideAutopilotProposal);

  const settingsQuery = useQuery({
    queryKey: ["autopilot", "settings"],
    queryFn: () => loadSettings(),
  });
  const proposalsQuery = useQuery({
    queryKey: ["autopilot", "proposals"],
    queryFn: () => loadProposals(),
    refetchInterval: 30_000,
  });

  const settings: AutopilotSettings = settingsQuery.data ?? DEFAULT_AUTOPILOT_SETTINGS;
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof saveSettings>[0]["data"]) => saveSettings({ data: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autopilot", "settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideMutation = useMutation({
    mutationFn: (input: { id: string; decision: "approve" | "reject" }) => decide({ data: input }),
    onSuccess: (res) => {
      toast.success(res.status === "approved" ? "Approved. Send it from the Broker page to execute." : "Proposal rejected.");
      qc.invalidateQueries({ queryKey: ["autopilot", "proposals"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = useMemo(
    () => (proposalsQuery.data ?? []).filter((p) => p.status === "pending"),
    [proposalsQuery.data],
  );
  const history = useMemo(
    () => (proposalsQuery.data ?? []).filter((p) => p.status !== "pending"),
    [proposalsQuery.data],
  );

  function setMode(mode: AutopilotMode) {
    save.mutate({ mode });
  }

  function toggleSymbol(symbol: string) {
    const next = settings.allowedSymbols.includes(symbol)
      ? settings.allowedSymbols.filter((s) => s !== symbol)
      : [...settings.allowedSymbols, symbol];
    save.mutate({ allowedSymbols: next });
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16">
      <PageHeader
        title="Autopilot"
        description="Decide how much the coach is allowed to do on its own. Every decision it makes is recorded below."
      />

      <section className="mt-6 rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Automation level</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(Object.keys(MODE_COPY) as AutopilotMode[]).map((mode) => {
            const active = settings.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setMode(mode)}
                className={`rounded-md border p-4 text-left transition-colors ${
                  active ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="h-4 w-4" />
                  {MODE_COPY[mode].label}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{MODE_COPY[mode].detail}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-4 rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Account</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {(["paper", "live"] as const).map((target) => (
            <button
              key={target}
              type="button"
              onClick={() => {
                if (target === "live" && !settings.liveAcknowledged) {
                  setLiveConfirmOpen(true);
                  return;
                }
                save.mutate({ accountTarget: target });
              }}
              className={`rounded-md border px-4 py-2 text-sm ${
                settings.accountTarget === target ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              {target === "paper" ? "Paper account" : "Live broker account"}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">
            {settings.accountTarget === "paper"
              ? "Nothing here touches real money."
              : "Orders go to your connected OANDA account."}
          </span>
        </div>

        {liveConfirmOpen && (
          <div className="mt-4 rounded-md border border-red-600/40 bg-red-950/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
              <ShieldAlert className="h-4 w-4" />
              Before you switch to live
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              You are authorizing automated order placement on your own broker account. TradeMind is not a broker,
              advisor, or money manager. You keep full responsibility for every order, and you can revoke this at any
              time by switching back to the paper account.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  save.mutate({ acknowledgeLive: true, accountTarget: "live" });
                  setLiveConfirmOpen(false);
                }}
                className="rounded-md border border-red-600/50 px-3 py-1.5 text-xs text-red-300"
              >
                I understand, use my live account
              </button>
              <button
                type="button"
                onClick={() => setLiveConfirmOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risk rails</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A proposal that breaks any of these is blocked before it ever reaches your broker.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs">
            <span className="text-muted-foreground">Minimum grade</span>
            <select
              value={settings.minGrade}
              onChange={(e) => save.mutate({ minGrade: e.target.value as AutopilotSettings["minGrade"] })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
            >
              <option value="A+">A+ only</option>
              <option value="A">A and above</option>
              <option value="B">B and above</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Risk per trade (%)</span>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="5"
              defaultValue={settings.riskPct}
              onBlur={(e) => save.mutate({ riskPct: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Max open positions</span>
            <input
              type="number"
              min="1"
              max="20"
              defaultValue={settings.maxOpenPositions}
              onBlur={(e) => save.mutate({ maxOpenPositions: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Max daily loss (%)</span>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="20"
              defaultValue={settings.maxDailyLossPct}
              onBlur={(e) => save.mutate({ maxDailyLossPct: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-5">
          <span className="text-xs text-muted-foreground">Allowed instruments</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {SYMBOL_CHOICES.map((symbol) => {
              const on = settings.allowedSymbols.includes(symbol);
              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => toggleSymbol(symbol)}
                  className={`rounded-md border px-3 py-1.5 text-xs ${
                    on ? "border-primary bg-primary/5" : "border-border text-muted-foreground"
                  }`}
                >
                  {symbol}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Waiting for you ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No proposals right now. Run a scan on the dashboard and the coach will send anything that clears your rails
            here.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((p) => (
              <li key={p.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{p.symbol}</span>
                  <span className="text-xs uppercase text-muted-foreground">
                    {p.side} {p.timeframe ? `· ${p.timeframe}` : ""}
                  </span>
                  {p.grade && <span className="rounded-md border border-border px-2 py-0.5 text-[11px]">{p.grade}</span>}
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    expires {new Date(p.expiresAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-muted-foreground">Entry</div>
                    <div className="font-mono">{p.entry}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Stop</div>
                    <div className="font-mono">{p.stopLoss ?? "-"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Target</div>
                    <div className="font-mono">{p.takeProfit ?? "-"}</div>
                  </div>
                </div>
                {p.reasoning && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{p.reasoning}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate({ id: p.id, decision: "approve" })}
                    className="flex items-center gap-1 rounded-md border border-emerald-600/50 px-3 py-1.5 text-xs text-emerald-400"
                  >
                    <Check className="h-3 w-3" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate({ id: p.id, decision: "reject" })}
                    className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs"
                  >
                    <X className="h-3 w-3" /> Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 rounded-md border border-border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Decision feed</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-3 text-xs">
                <span className="w-20 font-semibold">{p.symbol}</span>
                <span className="uppercase text-muted-foreground">{p.side}</span>
                <span className="font-mono text-muted-foreground">@ {p.entry}</span>
                <StatusPill status={p.status} />
                {p.rejectionReason && <span className="text-muted-foreground">{p.rejectionReason}</span>}
                <span className="ml-auto text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
