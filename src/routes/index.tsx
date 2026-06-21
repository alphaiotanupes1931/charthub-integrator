import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TradingViewChart } from "@/components/TradingViewChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chartly — Live Trading Charts & Market Analysis" },
      { name: "description", content: "View live stock, crypto, and forex charts with advanced technical analysis tools." },
      { property: "og:title", content: "Chartly — Live Trading Charts" },
      { property: "og:description", content: "Real-time market charts and analysis for traders." },
    ],
  }),
  component: Index,
});

const WATCHLIST = [
  { label: "S&P 500", symbol: "SPY" },
  { label: "Nasdaq", symbol: "QQQ" },
  { label: "Bitcoin", symbol: "BINANCE:BTCUSDT" },
  { label: "Ethereum", symbol: "BINANCE:ETHUSDT" },
  { label: "Apple", symbol: "NASDAQ:AAPL" },
  { label: "Tesla", symbol: "NASDAQ:TSLA" },
  { label: "Nvidia", symbol: "NASDAQ:NVDA" },
  { label: "Gold", symbol: "TVC:GOLD" },
  { label: "EUR/USD", symbol: "FX:EURUSD" },
];

const INTERVALS = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1H", value: "60" },
  { label: "4H", value: "240" },
  { label: "1D", value: "D" },
  { label: "1W", value: "W" },
];

function Index() {
  const [symbol, setSymbol] = useState("BINANCE:BTCUSDT");
  const [interval, setInterval] = useState("D");
  const [search, setSearch] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setSymbol(search.trim().toUpperCase());
      setSearch("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card/40 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Chartly</h1>
          </div>
          <form onSubmit={handleSearch} className="ml-auto flex w-full max-w-md items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search symbol (e.g. AAPL, BINANCE:BTCUSDT)"
                className="pl-9 font-mono"
              />
            </div>
            <Button type="submit">Load</Button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-6 py-6 lg:flex-row">
        <aside className="lg:w-64 shrink-0">
          <div className="rounded-xl border border-border bg-card p-3">
            <h2 className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Watchlist
            </h2>
            <div className="flex flex-col gap-1">
              {WATCHLIST.map((item) => (
                <button
                  key={item.symbol}
                  onClick={() => setSymbol(item.symbol)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    symbol === item.symbol
                      ? "bg-primary/15 text-primary"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.symbol.split(":").pop()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Symbol</div>
              <div className="font-mono text-lg font-semibold">{symbol}</div>
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  onClick={() => setInterval(i.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    interval === i.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-[600px] flex-1 overflow-hidden rounded-xl border border-border bg-card">
            <TradingViewChart symbol={symbol} interval={interval} />
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Charts powered by TradingView. Data for informational purposes only — not financial advice.
          </p>
        </main>
      </div>
    </div>
  );
}
