import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Loader2, Plus, ShieldX } from "lucide-react";
import {
  createInboundKey,
  listInboundKeys,
  revokeInboundKey,
  type InboundKey,
} from "@/lib/inbound-signals.functions";

/**
 * Lets a trader mint a key so an outside tool can file signals into the record.
 */
export function InboundSignalKeys() {
  const list = useServerFn(listInboundKeys);
  const create = useServerFn(createInboundKey);
  const revoke = useServerFn(revokeInboundKey);

  const [keys, setKeys] = useState<InboundKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("TradingView alerts");
  const [revealed, setRevealed] = useState<string | null>(null);

  const load = async () => {
    try {
      setKeys(await list());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your signal keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    setCreating(true);
    try {
      const key = await create({ data: { label: label.trim() || "Inbound signals", source: "webhook" } });
      setRevealed(key.token);
      await load();
      toast.success("Key created. Copy it now — it is not shown again.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the key");
    } finally {
      setCreating(false);
    }
  };

  const endpoint = `${typeof window === "undefined" ? "" : window.location.origin}/api/public/signals/file`;

  return (
    <section className="rounded-lg border border-border/60 bg-card/60 p-5">
      <h2 className="font-display text-lg">Signals from outside tools</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Post a signal from TradingView, n8n or your own script and it is filed, sealed and resolved against real closed
        bars on the same terms as ours. Outside signals are kept out of the published track record.
      </p>

      <div className="mt-4 rounded border border-border/50 bg-background/60 p-3 font-mono text-xs break-all">
        POST {endpoint}
        <br />
        Authorization: Bearer &lt;your key&gt;
        <br />
        {`{"symbol":"XAUUSD","timeframe":"60","bias":"long","entry":2350.5,"stop":2344.2,"tp1":2365}`}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="What is sending the signals?"
          className="h-9 min-w-56 flex-1 rounded border border-border/60 bg-background/60 px-3 text-sm"
        />
        <button
          onClick={onCreate}
          disabled={creating}
          className="inline-flex h-9 items-center gap-2 rounded bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create key
        </button>
      </div>

      {revealed ? (
        <div className="mt-3 flex items-center gap-2 rounded border border-primary/40 bg-primary/5 p-3">
          <code className="flex-1 break-all text-xs">{revealed}</code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(revealed);
              toast.success("Copied");
            }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Copy className="size-3.5" /> Copy
          </button>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-2 text-sm">
              <span className="min-w-32 flex-1">{k.label}</span>
              <code className="text-xs text-muted-foreground">{k.tokenPrefix}</code>
              <span className="text-xs text-muted-foreground">
                {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "Never used"}
              </span>
              {k.revoked ? (
                <span className="text-xs text-muted-foreground">Revoked</span>
              ) : (
                <button
                  onClick={async () => {
                    await revoke({ data: { id: k.id } });
                    await load();
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ShieldX className="size-3.5" /> Revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
