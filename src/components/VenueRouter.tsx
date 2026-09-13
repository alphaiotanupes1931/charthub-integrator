import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plug } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { BROKER_BY_ID } from "@/lib/brokers/registry";
import { listBrokerConnections } from "@/lib/brokers.functions";
import { VenueOrderTicket } from "@/components/VenueOrderTicket";

type Prefill = {
  symbol?: string;
  side?: "buy" | "sell";
  limitPrice?: string;
  stopLoss?: string;
  takeProfit?: string;
};

/**
 * Lets a setup be routed to any connected venue that supports order routing,
 * not just OANDA. Symbols stay venue-native, so the field is editable.
 */
export function VenueRouter({ prefill, exclude = [] }: { prefill?: Prefill; exclude?: string[] }) {
  const fetchConns = useServerFn(listBrokerConnections);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Array<{ broker: string; env: string }>>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await fetchConns({});
        if (!alive) return;
        const tradable = rows
          .filter((r) => BROKER_BY_ID[r.broker]?.trading && !exclude.includes(r.broker))
          .map((r) => ({ broker: r.broker, env: r.env }));
        setVenues(tradable);
        setActive(tradable[0]?.broker ?? null);
      } catch {
        setVenues([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" /> Checking your connected venues
      </div>
    );
  }

  if (venues.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-5">
        <div className="text-sm font-semibold">Route to another venue</div>
        <p className="mt-2 text-xs text-muted-foreground">
          Alpaca, Tradier, Coinbase, Tradovate and Binance (outside the US) can execute orders from a setup once
          connected. US traders: Coinbase for crypto, Tradovate or IBKR for index and gold futures.
        </p>

        <Link
          to="/connections"
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-1.5 text-xs"
        >
          <Plug className="h-3.5 w-3.5" /> Connect a venue
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <div className="text-sm font-semibold">Route to another connected venue</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {venues.map((v) => {
          const def = BROKER_BY_ID[v.broker];
          return (
            <button
              key={v.broker}
              type="button"
              onClick={() => setActive(v.broker)}
              className={`rounded-xl border px-2.5 py-1 text-xs ${
                active === v.broker
                  ? "border-foreground bg-foreground text-background"
                  : "border-border/60 text-muted-foreground"
              }`}
            >
              {def?.name ?? v.broker} · {v.env === "live" ? "Live" : "Demo"}
            </button>
          );
        })}
      </div>
      {active ? (
        <VenueOrderTicket
          key={active}
          broker={active}
          venueName={BROKER_BY_ID[active]?.name ?? active}
          initial={prefill}
        />
      ) : null}
    </div>
  );
}
