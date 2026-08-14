import { ArrowDownRight, ArrowUpRight, ExternalLink } from "lucide-react";

// Bottom-of-chart trade bar. Sends the trader straight to TradingView on the
// exact instrument shown on the chart so they can place the order there.
export function ChartTradeBar({
  tvSymbol,
  ticker,
  interval,
  bias,
}: {
  tvSymbol: string;
  ticker?: string;
  interval?: string;
  bias?: "long" | "short" | "neutral";
}) {
  const tvUrl = (side: "buy" | "sell") => {
    const params = new URLSearchParams({ symbol: tvSymbol });
    if (interval) params.set("interval", interval);
    // side is informational for the trader; TradingView opens its own ticket.
    params.set("aff_sub", side);
    return `https://www.tradingview.com/chart/?${params.toString()}`;
  };

  const label = ticker ?? tvSymbol;

  return (
    <div className="flex items-center gap-2 border-t border-border/60 bg-card px-3 py-2">
      <span className="hidden sm:inline text-[10px] font-mono tracking-tight text-muted-foreground">
        Trade {label} on TradingView
      </span>
      <div className="ml-auto flex items-center gap-2">
        <a
          href={tvUrl("buy")}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex h-8 items-center gap-1.5 rounded-2xl px-4 text-[11px] font-bold tracking-tight transition ${
            bias === "short"
              ? "border border-border/60 text-foreground hover:bg-muted/60"
              : "bg-bull text-background hover:opacity-90"
          }`}
          title={`Open ${label} on TradingView and buy`}
        >
          <ArrowUpRight className="h-3.5 w-3.5" /> Buy
          <ExternalLink className="h-3 w-3 opacity-70" />
        </a>
        <a
          href={tvUrl("sell")}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex h-8 items-center gap-1.5 rounded-2xl px-4 text-[11px] font-bold tracking-tight transition ${
            bias === "short"
              ? "bg-destructive text-destructive-foreground hover:opacity-90"
              : "border border-border/60 text-foreground hover:bg-muted/60"
          }`}
          title={`Open ${label} on TradingView and sell`}
        >
          <ArrowDownRight className="h-3.5 w-3.5" /> Sell
          <ExternalLink className="h-3 w-3 opacity-70" />
        </a>
      </div>
    </div>
  );
}

export default ChartTradeBar;
