import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, ShieldCheck, Info, Activity } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { TradingViewChart } from "@/components/TradingViewChart";

export const Route = createFileRoute("/_app/broker")({
  head: () => ({ meta: [{ title: "Broker, TradeMind" }] }),
  component: BrokerPage,
});

const BROKERS = [
  { name: "OANDA", style: "FX, CFDs", url: "https://www.tradingview.com/broker-profile/OANDA/" },
  { name: "Tradovate", style: "Futures", url: "https://www.tradingview.com/broker-profile/Tradovate/" },
  { name: "TradeStation", style: "Stocks, options, futures", url: "https://www.tradingview.com/broker-profile/Tradestation/" },
  { name: "Interactive Brokers", style: "Global multi-asset", url: "https://www.tradingview.com/broker-profile/InteractiveBrokers/" },
  { name: "Capital.com", style: "CFDs", url: "https://www.tradingview.com/broker-profile/CAPITALCOM/" },
  { name: "FXCM", style: "FX", url: "https://www.tradingview.com/broker-profile/FXCM/" },
];

function BrokerPage() {
  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Broker"
        icon={<Activity className="h-8 w-8 text-primary" />}
        description={
          <>
            Connect a live brokerage account through TradingView and execute trades from the embedded chart below. TradeMind reads what's on the chart and grades the setup; TradingView routes the order to your broker.
          </>
        }
      />

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.05] p-4 flex gap-3 text-sm">
        <Info className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-300">How broker connection works</div>
          <p className="text-muted-foreground leading-relaxed">
            TradeMind is not a broker. We integrate with TradingView's broker panel, which connects to regulated brokers (OANDA, Tradovate, Interactive Brokers, and others). You sign into your broker through TradingView once, and the trade ticket appears at the bottom of the embedded chart. All KYC, margin, and order execution happens at your broker, not here.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" /> Live chart with broker terminal
          </div>
          <a
            href="https://www.tradingview.com/u/#broker-profile"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            Manage broker on TradingView <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="h-[640px]">
          <TradingViewChart symbol="OANDA:XAUUSD" interval="60" />
        </div>
        <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
          Tap the <span className="text-foreground font-medium">Trading Panel</span> button on the chart toolbar to open the broker terminal. If you haven't connected a broker yet, TradingView will prompt you.
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3">Popular brokers supported via TradingView</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {BROKERS.map((b) => (
            <a
              key={b.name}
              href={b.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border bg-card p-4 hover:border-primary/40 transition flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{b.name}</div>
                <div className="text-xs text-muted-foreground truncate">{b.style}</div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
            </a>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Educational analysis only, not financial advice. You are solely responsible for trades executed at your broker.
      </p>
    </div>
  );
}
