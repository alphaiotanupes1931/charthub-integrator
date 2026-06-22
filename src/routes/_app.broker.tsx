import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ExternalLink, ShieldCheck, Info, Activity, Camera, Maximize2, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { TradingViewChart } from "@/components/TradingViewChart";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/broker")({
  head: () => ({ meta: [{ title: "Broker, TradeMind" }] }),
  component: BrokerPage,
});

const INSTRUMENTS = [
  { label: "Gold (XAU/USD)", symbol: "OANDA:XAUUSD", group: "FX / Metals" },
  { label: "EUR/USD", symbol: "OANDA:EURUSD", group: "FX / Metals" },
  { label: "GBP/USD", symbol: "OANDA:GBPUSD", group: "FX / Metals" },
  { label: "USD/JPY", symbol: "OANDA:USDJPY", group: "FX / Metals" },
  { label: "S&P 500 (ES)", symbol: "CME_MINI:ES1!", group: "Futures" },
  { label: "Nasdaq (NQ)", symbol: "CME_MINI:NQ1!", group: "Futures" },
  { label: "Bitcoin", symbol: "BINANCE:BTCUSDT", group: "Crypto" },
  { label: "Ethereum", symbol: "BINANCE:ETHUSDT", group: "Crypto" },
  { label: "Apple", symbol: "NASDAQ:AAPL", group: "Stocks" },
  { label: "Tesla", symbol: "NASDAQ:TSLA", group: "Stocks" },
];

const INTERVALS = [
  { label: "1m", v: "1" },
  { label: "5m", v: "5" },
  { label: "15m", v: "15" },
  { label: "1H", v: "60" },
  { label: "4H", v: "240" },
  { label: "1D", v: "D" },
];

function openTradingFloor(symbol: string) {
  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
  // Side-anchored popup so the broker terminal feels docked next to TradeMind.
  const width = Math.min(1100, Math.round(window.screen.availWidth * 0.55));
  const height = Math.round(window.screen.availHeight * 0.92);
  const left = Math.max(0, window.screen.availWidth - width);
  const top = 0;
  const features = `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`;
  const w = window.open(url, "trademind_tv_floor", features);
  if (!w) {
    toast.error("Popup blocked — allow popups for TradeMind to open the trading floor.");
    return;
  }
  w.focus();
}

function BrokerPage() {
  const [symbol, setSymbol] = useState(INSTRUMENTS[0].symbol);
  const [interval, setInterval] = useState("60");
  const navigate = useNavigate();
  const current = INSTRUMENTS.find((i) => i.symbol === symbol) ?? INSTRUMENTS[0];

  const snapshotToJournal = () => {
    try {
      localStorage.setItem(
        "trademind.journal.prefill.v1",
        JSON.stringify({
          symbol: current.label.replace(/\s*\(.*\)/, ""),
          timeframe: INTERVALS.find((i) => i.v === interval)?.label ?? "1H",
          notes: `Setup snapshot from broker view (${current.symbol} @ ${interval})`,
          createdAt: Date.now(),
        }),
      );
      toast.success("Snapshot sent to Trade Journal");
      navigate({ to: "/journal" });
    } catch {
      toast.error("Couldn't pass snapshot to the journal");
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <PageHeader
        title="Broker"
        icon={<Activity className="h-8 w-8 text-primary" />}
        description={
          <>
            Live chart on the left, broker terminal docked on the right. Sign into TradingView once and your broker (OANDA, Tradovate, IBKR, and others) stays connected — execute trades without leaving TradeMind.
          </>
        }
      />

      <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.05] p-4 flex gap-3 text-sm">
        <Info className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-300">How this works</div>
          <p className="text-muted-foreground leading-relaxed">
            TradeMind isn't a broker — TradingView is. The chart below is your analysis surface (TradeMind reads it and grades the setup). The <span className="text-foreground font-medium">Open Trading Floor</span> button opens TradingView's full chart and broker panel docked to the right of this window. Sign in once, place trades there, snapshot back to your journal here. No API key, no risk we ever touch your broker credentials.
          </p>
        </div>
      </div>

      {/* Instrument + timeframe + actions */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-2">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:border-primary/50 min-w-[200px]"
        >
          {Object.entries(
            INSTRUMENTS.reduce<Record<string, typeof INSTRUMENTS>>((acc, i) => {
              (acc[i.group] ??= []).push(i);
              return acc;
            }, {}),
          ).map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((i) => <option key={i.symbol} value={i.symbol}>{i.label}</option>)}
            </optgroup>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
          {INTERVALS.map((tf) => (
            <button
              key={tf.v}
              onClick={() => setInterval(tf.v)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                interval === tf.v ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={snapshotToJournal}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-primary/40 hover:text-foreground text-muted-foreground"
        >
          <Camera className="h-4 w-4" /> Snapshot to Journal
        </button>
        <button
          onClick={() => openTradingFloor(symbol)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Maximize2 className="h-4 w-4" /> Open Trading Floor
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" /> Live chart — {current.label}
          </div>
          <a
            href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            Open on TradingView <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="h-[640px]">
          <TradingViewChart symbol={symbol} interval={interval} />
        </div>
      </div>

      {/* Step-by-step */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { n: 1, t: "Pick instrument", d: "Select the symbol and timeframe you want to trade above. The chart updates instantly." },
          { n: 2, t: "Open the trading floor", d: "Click 'Open Trading Floor' — TradingView opens docked to the right with the broker terminal at the bottom." },
          { n: 3, t: "Trade and snapshot", d: "Sign into your broker once on TradingView. Place trades there. Hit 'Snapshot to Journal' to log the setup here." },
        ].map((s) => (
          <div key={s.n} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center">{s.n}</div>
              <div className="font-medium text-sm">{s.t}</div>
            </div>
            <div className="text-xs text-muted-foreground leading-relaxed">{s.d}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="font-medium text-sm mb-1">Don't have a broker connected yet?</div>
          <div className="text-xs text-muted-foreground">
            Pick any TradingView-supported broker (OANDA, Tradovate, Interactive Brokers, TradeStation, Capital.com, FXCM). Sign up with them, then sign in once inside the trading floor — that's it.
          </div>
        </div>
        <a
          href="https://www.tradingview.com/brokers/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
        >
          Browse supported brokers <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Educational analysis only, not financial advice. Orders execute at your broker via TradingView — TradeMind never holds your broker credentials or routes orders.
      </p>
    </div>
  );
}
