interface Props {
  symbols: { proName: string; title: string }[];
}

const DEMO: Record<string, { price: string; change: string; pct: string; up: boolean }> = {
  "OANDA:XAUUSD": { price: "4,191.20", change: "+12.85", pct: "+0.31%", up: true },
  "BINANCE:BTCUSDT": { price: "98,420.50", change: "+1,240.20", pct: "+1.28%", up: true },
  "FOREXCOM:NSXUSD": { price: "21,847.30", change: "-42.10", pct: "-0.19%", up: false },
  "FOREXCOM:SPXUSD": { price: "6,124.80", change: "+8.42", pct: "+0.14%", up: true },
  "FOREXCOM:DJI": { price: "44,892.10", change: "+115.20", pct: "+0.26%", up: true },
  "FX:EURUSD": { price: "1.0584", change: "+0.0021", pct: "+0.20%", up: true },
};

export function TickerTape({ symbols }: Props) {
  // Duplicate for seamless marquee loop
  const items = [...symbols, ...symbols];

  return (
    <div className="relative overflow-hidden bg-transparent">
      <div className="flex animate-ticker-scroll whitespace-nowrap py-3">
        {items.map((s, i) => {
          const d = DEMO[s.proName] ?? { price: "—", change: "0.00", pct: "0.00%", up: true };
          return (
            <div
              key={`${s.proName}-${i}`}
              className="inline-flex items-center gap-2 px-6 border-r border-border/40"
            >
              <span className="text-xs font-semibold text-foreground">{s.title}</span>
              <span className="text-xs font-mono text-muted-foreground">{d.price}</span>
              <span
                className={`text-[11px] font-mono ${
                  d.up ? "text-emerald-400" : "text-destructive"
                }`}
              >
                {d.change} ({d.pct})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
