import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import BridgePanel from "@/components/BridgePanel";
import { motion } from "framer-motion";
import { Check, ExternalLink, Loader2, Plug, RefreshCw, ShieldCheck, Trash2, X, Send } from "lucide-react";
import {
  BROKERS,
  BROKER_GROUPS,
  type BrokerDef,
} from "@/lib/brokers/registry";
import {
  listBrokerConnections,
  saveBrokerConnection,
  testBrokerConnection,
  deleteBrokerConnection,
} from "@/lib/brokers.functions";
import { VenueOrderTicket } from "@/components/VenueOrderTicket";

export const Route = createFileRoute("/_app/connections")({
  head: () => ({
    meta: [
      { title: "Broker connections — TradeMind" },
      {
        name: "description",
        content:
          "Connect your trading accounts to TradeMind. 20 supported brokers and exchanges across forex, futures, stocks and crypto.",
      },
      { property: "og:title", content: "Broker connections — TradeMind" },
      {
        property: "og:description",
        content: "Link forex, futures, stock and crypto accounts to TradeMind with encrypted API credentials.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConnectionsPage,
});

type Conn = {
  broker: string;
  accountId: string | null;
  env: string;
  updatedAt: string;
};

function ConnectionsPage() {
  const fetchConns = useServerFn(listBrokerConnections);
  const save = useServerFn(saveBrokerConnection);
  const test = useServerFn(testBrokerConnection);
  const remove = useServerFn(deleteBrokerConnection);

  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [env, setEnv] = useState("practice");
  const [filter, setFilter] = useState<"all" | BrokerDef["group"]>("all");

  const connMap = useMemo(
    () => Object.fromEntries(conns.map((c) => [c.broker, c])) as Record<string, Conn>,
    [conns],
  );

  const load = async () => {
    try {
      setConns(await fetchConns());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load connections");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openForm = (def: BrokerDef) => {
    setOpenId(def.id);
    setForm({});
    setEnv(def.envs?.[0]?.value ?? "practice");
  };

  const onSave = async (def: BrokerDef) => {
    setBusy(def.id);
    try {
      const res = await save({
        data: {
          broker: def.id,
          env: def.envs ? env : "practice",
          creds: {
            apiKey: form.apiKey,
            apiSecret: form.apiSecret,
            passphrase: form.passphrase,
            accountId: form.accountId,
            username: form.username,
            password: form.password,
            token: form.token,
          },
        },
      });
      if (!res.ok) {
        toast.error(`${def.name} rejected the credentials`, { description: res.detail });
        return;
      }
      toast.success(`${def.name} connected`, { description: res.detail });
      setOpenId(null);
      setForm({});
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save credentials");
    } finally {
      setBusy(null);
    }
  };

  const onTest = async (def: BrokerDef) => {
    setBusy(def.id);
    try {
      const res = await test({ data: { broker: def.id } });
      if (res.ok) toast.success(`${def.name} reachable`, { description: res.detail });
      else toast.error(`${def.name} check failed`, { description: res.detail });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async (def: BrokerDef) => {
    setBusy(def.id);
    try {
      await remove({ data: { broker: def.id } });
      toast.success(`${def.name} disconnected`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  };

  const visibleGroups = filter === "all" ? BROKER_GROUPS : [filter];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-display tracking-tight">Broker connections</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Link the accounts you trade. Credentials are encrypted before they are stored and are only
          decrypted on the server when a request runs. Nothing is ever sent to your browser.
          {" "}
          {conns.length} of {BROKERS.length} connected.
        </p>
      </header>
      <PageInstructions className="mb-6" />

      <div className="mb-6 flex flex-wrap gap-2">
        {(["all", ...BROKER_GROUPS] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setFilter(g as "all" | BrokerDef["group"])}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              filter === g ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground"
            }`}
          >
            {g === "all" ? "All brokers" : g}
          </button>
        ))}
      </div>

      <BridgePanel />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your connections
        </div>
      ) : (
        visibleGroups.map((group) => (
          <section key={group} className="mb-8">
            <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">{group}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {BROKERS.filter((b) => b.group === group).map((def) => {
                const conn = connMap[def.id];
                const isOpen = openId === def.id;
                return (
                  <motion.div
                    key={def.id}
                    layout
                    whileHover={{ y: -2 }}
                    transition={{ type: "spring", stiffness: 300, damping: 24 }}
                    className="rounded-md border border-border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{def.name}</span>
                          {conn ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                              <Check className="h-3 w-3" /> {conn.env === "live" ? "Live" : "Demo"}
                            </span>
                          ) : null}
                          {def.trading ? (
                            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                              Order routing
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{def.assets.join(" · ")}</p>
                      </div>
                      <a
                        href={def.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`${def.name} API documentation`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{def.notes}</p>

                    {isOpen ? (
                      <div className="mt-4 space-y-3 border-t border-border pt-4">
                        {def.envs ? (
                          <div className="flex gap-2">
                            {def.envs.map((e) => (
                              <button
                                key={e.value}
                                type="button"
                                onClick={() => setEnv(e.value)}
                                className={`rounded-md border px-2.5 py-1 text-xs ${
                                  env === e.value
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border text-muted-foreground"
                                }`}
                              >
                                {e.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {def.fields.map((f) => (
                          <label key={f.key} className="block">
                            <span className="text-xs text-muted-foreground">
                              {f.label}
                              {f.optional ? " (optional)" : ""}
                            </span>
                            <input
                              type={f.secret ? "password" : "text"}
                              autoComplete="off"
                              value={form[f.key] ?? ""}
                              onChange={(ev) => setForm((p) => ({ ...p, [f.key]: ev.target.value }))}
                              className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-foreground"
                            />
                          </label>
                        ))}
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="button"
                            disabled={busy === def.id}
                            onClick={() => void onSave(def)}
                            className="inline-flex items-center gap-2 rounded-md border border-foreground bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-60"
                          >
                            {busy === def.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            )}
                            {def.testable ? "Verify and save" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenId(null)}
                            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground"
                          >
                            <X className="h-3.5 w-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openForm(def)}
                          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
                        >
                          <Plug className="h-3.5 w-3.5" /> {conn ? "Replace keys" : "Connect"}
                        </button>
                        {conn ? (
                          <>
                            <button
                              type="button"
                              disabled={busy === def.id}
                              onClick={() => void onTest(def)}
                              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-60"
                            >
                              {busy === def.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" />
                              )}
                              Test
                            </button>
                            <button
                              type="button"
                              disabled={busy === def.id}
                              onClick={() => void onRemove(def)}
                              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-60"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Disconnect
                            </button>
                            {def.trading ? (
                              <button
                                type="button"
                                onClick={() => setTicketId(ticketId === def.id ? null : def.id)}
                                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
                              >
                                <Send className="h-3.5 w-3.5" />
                                {ticketId === def.id ? "Hide ticket" : "Send order"}
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    )}
                    {conn && def.trading && ticketId === def.id && !isOpen ? (
                      <VenueOrderTicket broker={def.id} venueName={def.name} />
                    ) : null}

                  </motion.div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
