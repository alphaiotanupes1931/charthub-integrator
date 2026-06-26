interface Props {
  symbols: { proName: string; title: string }[];
}

const DEMO_PRICES: Record<string, { price: string; change: string; up: boolean }> = {
  "OANDA:XAUUSD": { price: "2,418.55", change: "+0.62%", up: true },
  "BINANCE:BTCUSDT": { price: "67,842", change: "+1.18%", up: true },
  "FOREXCOM:NSXUSD": { price: "19,734", change: "-0.24%", up: false },
  "FOREXCOM:SPXUSD": { price: "5,612", change: "+0.31%", up: true },
  "FOREXCOM:DJI": { price: "40,128", change: "-0.08%", up: false },
  "FX:EURUSD": { price: "1.0842", change: "+0.14%", up: true },
};

/**
 * Demo ticker tape for the public landing page.
 * Static, deterministic values - no network, no live market data.
 */
export function TickerTape({ symbols }: Props) {
  const row = symbols.map((s) => {
    const d = DEMO_PRICES[s.proName] ?? { price: "-", change: "0.00%", up: true };
    return { ...s, ...d };
  });
  // duplicate to make the marquee seamless
  const items = [...row, ...row];

  return (
    <div className="relative overflow-hidden bg-transparent py-2.5">
      <div className="flex gap-8 whitespace-nowrap animate-marquee">
        {items.map((it, i) => (
          <div key={`${it.proName}-${i}`} className="flex items-center gap-2 font-mono text-xs">
            <span className="text-muted-foreground">{it.title}</span>
            <span className="text-foreground">{it.price}</span>
            <span className={it.up ? "text-emerald-400" : "text-destructive"}>{it.change}</span>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 40s linear infinite;
          width: max-content;
        }
      `}</style>
    </div>
  );
}
