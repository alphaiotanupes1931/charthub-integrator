// Desktop bridge: IBKR and NinjaTrader have no cloud order API, so orders are
// queued here and pulled by a bridge process running next to the platform.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Loader2, Terminal, RefreshCw, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getBridgeToken,
  rotateBridgeToken,
  listBridgeOrders,
  cancelBridgeOrder,
  type BridgeOrder,
} from "@/lib/bridge.functions";

const STATUS_COPY: Record<string, string> = {
  queued: "Waiting for the bridge",
  sent: "Sent to the platform",
  filled: "Filled",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export default function BridgePanel() {
  const load = useServerFn(getBridgeToken);
  const rotate = useServerFn(rotateBridgeToken);
  const list = useServerFn(listBridgeOrders);
  const cancel = useServerFn(cancelBridgeOrder);

  const [token, setToken] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [orders, setOrders] = useState<BridgeOrder[]>([]);
  const [busy, setBusy] = useState(true);

  const refresh = async () => {
    try {
      const [t, o] = await Promise.all([load(), list()]);
      setToken(t.token);
      setLastSeen(t.lastSeenAt);
      setOrders(o);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const endpoint = typeof window === "undefined" ? "" : `${window.location.origin}/api/public/bridge`;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Desktop bridge</h2>
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-start gap-2">
          <Terminal className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Interactive Brokers and NinjaTrader</p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Neither platform accepts orders over the internet, so they run through a small bridge on the machine where
              TWS or NinjaTrader is open. The bridge polls this endpoint with your token, places the order locally, then
              reports the fill back. Orders sit as Waiting until the bridge picks them up.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Endpoint</span>
            <code className="rounded border border-border px-2 py-1">{endpoint}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Bridge token</span>
            <code className="rounded border border-border px-2 py-1">
              {busy ? "loading" : token ? `${token.slice(0, 8)}${"\u2022".repeat(12)}` : "none"}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { if (token) { void navigator.clipboard.writeText(token); toast.success("Token copied"); } }}
              disabled={!token}
            >
              <Copy className="mr-1 h-3 w-3" /> Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await rotate();
                setToken(res.token);
                toast.success("New token issued. Update your bridge config.");
              }}
            >
              <RefreshCw className="mr-1 h-3 w-3" /> Rotate
            </Button>
          </div>
          <p className="text-muted-foreground">
            {lastSeen ? `Bridge last checked in ${new Date(lastSeen).toLocaleString()}.` : "The bridge has not checked in yet."}
          </p>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Order queue</h3>
            <Button size="sm" variant="ghost" onClick={() => void refresh()}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
          {orders.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No bridge orders yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-normal">Venue</th>
                    <th className="py-2 text-left font-normal">Symbol</th>
                    <th className="py-2 text-left font-normal">Side</th>
                    <th className="py-2 text-right font-normal">Qty</th>
                    <th className="py-2 text-left font-normal">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <motion.tr key={o.id} layout className="border-b border-border/50">
                      <td className="py-2">{o.venue}</td>
                      <td className="py-2">{o.symbol}</td>
                      <td className="py-2">{o.side}</td>
                      <td className="py-2 text-right">{o.quantity}</td>
                      <td className="py-2">
                        {STATUS_COPY[o.status] ?? o.status}
                        {o.error ? <span className="ml-1 text-red-500">{o.error}</span> : null}
                      </td>
                      <td className="py-2 text-right">
                        {o.status === "queued" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => { await cancel({ data: { id: o.id } }); void refresh(); }}
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
