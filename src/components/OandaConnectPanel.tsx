import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, ExternalLink, Trash2, RefreshCw, LogIn } from "lucide-react";
import {
  saveOandaCredentials,
  setOandaActiveEnv,
  deleteOandaCredentials,
  getOandaCredentialsMeta,
} from "@/lib/broker-credentials.functions";

type Meta = Awaited<ReturnType<typeof getOandaCredentialsMeta>>;

/**
 * OANDA sign-in, reduced to a single field. The trader pastes one personal
 * access token; the server figures out whether it is a demo or live token and
 * which account it authorizes. The token is encrypted server-side and never
 * returned to the browser.
 */
export function OandaConnectPanel({ onChange }: { onChange?: () => void }) {
  const getMeta = useServerFn(getOandaCredentialsMeta);
  const save = useServerFn(saveOandaCredentials);
  const setEnv = useServerFn(setOandaActiveEnv);
  const remove = useServerFn(deleteOandaCredentials);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [apiKey, setApiKey] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const m = await getMeta();
      setMeta(m);
      setShowForm(!m.configured);
    } catch {
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setBusy(true);
    try {
      const res = await save({ data: { apiKey: apiKey.trim(), makeActive: true } });
      toast.success(`Signed in to your OANDA ${res.env === "live" ? "live" : "demo"} account`);
      setApiKey("");
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSwitch(next: "practice" | "live") {
    setBusy(true);
    try {
      await setEnv({ data: { env: next } });
      toast.success(`Trading routes to your ${next === "practice" ? "demo" : "live"} account`);
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(target: "practice" | "live") {
    setBusy(true);
    try {
      await remove({ data: { env: target } });
      toast.success("Account removed");
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">OANDA</div>
        {loading ? (
          <RefreshCw className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <span
            className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${
              meta?.configured ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {meta?.configured ? "Signed in" : "Not signed in"}
          </span>
        )}
      </div>

      {meta?.configured && (
        <div className="space-y-2 mb-4">
          {meta.accounts.filter((a) => a.env === "live").map((a) => (
            <div key={a.env} className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs">
              <span className="font-semibold">Live</span>
              <span className="font-mono text-muted-foreground truncate">{a.accountId}</span>
              <div className="flex-1" />
              {a.active ? (
                <span className="rounded bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">Active</span>
              ) : (
                <button
                  onClick={() => handleSwitch(a.env)}
                  disabled={busy}
                  className="rounded-lg border border-border/60 px-2 py-1 font-semibold hover:bg-muted disabled:opacity-50"
                >
                  Use this
                </button>
              )}
              <button
                onClick={() => handleRemove(a.env)}
                disabled={busy}
                className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                aria-label="Remove account"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {meta.accounts.every((a) => a.env !== "live") && (
            <p className="text-xs text-muted-foreground">
              The token you saved is not a live OANDA account. Paste a live account token below to trade.
            </p>
          )}
        </div>
      )}


      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-muted"
        >
          Add another account
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            One step: paste your OANDA access token. We detect whether it is a demo or live account automatically, and
            the token stays encrypted on the server.
          </p>
          <input
            value={apiKey}
            onChange={(ev) => setApiKey(ev.target.value)}
            type="password"
            autoComplete="off"
            placeholder="Paste your OANDA access token"
            className="w-full rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={busy || apiKey.trim().length < 20}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" /> {busy ? "Signing in..." : "Sign in to OANDA"}
            </button>
            <a
              href="https://www.oanda.com/account/tpa/personal_token"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Get your token <ExternalLink className="h-3 w-3" />
            </a>
            {meta?.configured && (
              <button onClick={() => setShowForm(false)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
