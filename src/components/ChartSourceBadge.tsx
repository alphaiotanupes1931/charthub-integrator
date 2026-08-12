import { Database } from "lucide-react";

/**
 * Small, consistent "where this chart's data comes from" pill.
 * Used on every chart so traders can always see the live feed behind the prices.
 */
export function ChartSourceBadge({
  label,
  live,
  className = "",
}: {
  label: string;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      title={`Price data provider: ${label}`}
      className={`inline-flex items-center gap-1 rounded-md border border-border bg-background/80 backdrop-blur px-1.5 py-0.5 text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-muted-foreground ${className}`}
    >
      {live ? (
        <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulse" />
      ) : (
        <Database className="h-2.5 w-2.5" />
      )}
      <span className="normal-case">Data:</span>
      <span className="text-foreground">{label}</span>
    </span>
  );
}

/** Human name for each price feed we can pull from. */
export function feedLabel(source: string | null | undefined): string {
  switch (source) {
    case "coingecko":
      return "CoinGecko";
    case "twelvedata":
      return "Twelve Data";
    case "yahoo":
      return "Yahoo Finance";
    case "oanda":
      return "OANDA";
    case "binance":
      return "Binance";
    case "cached":
      return "Cached history";
    case "stooq":
      return "Stooq";
    case "backup":
      return "Backup feed";
    case "tradingview":
      return "TradingView";
    case "synthetic":
      return "Simulated";
    default:
      return "No feed";
  }
}
