import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Plain-English definitions for the trading shorthand used across the app, so
 * someone who has never traded can still read a signal card.
 */
export const GLOSSARY: Record<string, { term: string; text: string }> = {
  entry: { term: "Entry", text: "The price where you would open the trade. Nothing happens until price reaches it." },
  stop: { term: "Stop loss", text: "The price where you exit if the idea is wrong. It caps how much you can lose." },
  tp1: { term: "Take profit 1", text: "First target. Many traders close part of the position here and move the stop to break even." },
  tp2: { term: "Take profit 2", text: "Second, further target for the rest of the position if the move keeps running." },
  rr: { term: "R:R (reward to risk)", text: "How much you stand to make compared to what you risk. 2:1 means the target is twice the distance of the stop." },
  r: { term: "R (risk unit)", text: "One R is the distance from entry to stop. A 2R win makes twice what you risked." },
  grade: { term: "Grade", text: "Our quality score for the setup, A down to F. A and B setups meet every rule; C and below have something missing." },
  bias: { term: "Bias", text: "The direction the market is currently favouring: long (up), short (down), or neutral (unclear)." },
  atr: { term: "ATR (average true range)", text: "How far price typically moves in one candle. Used to size stops so they are not too tight." },
  bos: { term: "BOS (break of structure)", text: "Price closes beyond the last swing high or low, confirming the trend is continuing." },
  choch: { term: "CHoCH (change of character)", text: "The first sign a trend may be turning: price breaks the opposite swing instead of continuing." },
  fvg: { term: "FVG (fair value gap)", text: "A gap left by a fast move. Price often comes back to fill it before continuing." },
  orderBlock: { term: "Order block", text: "The last candle before a strong move. Institutions often defend that area again later." },
  liquidity: { term: "Liquidity", text: "Clusters of stop orders above highs or below lows that price tends to reach for before reversing." },
  orderFlow: { term: "Order flow", text: "Who is actually buying and selling right now, read from volume and delta rather than the candle shape." },
  delta: { term: "Delta", text: "Buying volume minus selling volume. Positive delta means buyers are more aggressive." },
  poc: { term: "POC (point of control)", text: "The price with the most traded volume in the session - a magnet that price often revisits." },
  valueArea: { term: "Value area", text: "The price band where about 70% of the volume traded. Edges of it often act as support or resistance." },
  volume: { term: "Volume", text: "How much traded in a period. Thin volume makes moves unreliable, so we downgrade setups." },
  session: { term: "Session", text: "Which market hours are active (Sydney, Tokyo, London, New York). Each has its own typical volume and range." },
  confidence: { term: "Confidence", text: "How strongly the checks agreed with each other. Lower confidence means fewer confirmations lined up." },
  pnl: { term: "P&L", text: "Profit and loss - what the trade actually made or lost after it closed." },
  mfe: { term: "MFE (max favourable excursion)", text: "The best price the trade reached before you exited - shows whether you left money on the table." },
  buyStop: { term: "Buy stop / sell stop", text: "An order placed beyond current price that triggers on a breakout in that direction." },
  buyLimit: { term: "Buy limit / sell limit", text: "An order placed on the other side of current price that fills when price pulls back to it." },
  htf: { term: "HTF (higher timeframe)", text: "A slower chart such as 4H or daily. It sets the overall direction that lower timeframes trade inside." },
  mtf: { term: "MTF alignment", text: "4H, 1H and 15m all pointing the same way. Setups only grade high when they agree." },
  drawdown: { term: "Drawdown", text: "How far your account fell from its highest point - the pain a strategy puts you through." },
  winRate: { term: "Win rate", text: "The share of trades that closed profitable. On its own it means little without R:R." },
  hitRate: { term: "Hit rate", text: "Of the scans that have finished, the share that reached take profit before the stop. Measured from real price bars, not from trades you logged." },
  avgR: { term: "Avg R", text: "The average result per finished scan, measured in risk units. +0.5R means each scan made half of what it risked, on average." },
  gradeA: { term: "A-grade hit rate", text: "Hit rate counting only A and A+ setups - the ones where every rule lined up. It is normally well above the all-grades number." },
  expectancy: { term: "Expectancy", text: "Average profit per trade in R, combining win rate and reward to risk." },
};

export function InfoTip({
  id,
  term,
  text,
  className,
}: {
  /** Key into GLOSSARY, or pass term/text directly. */
  id?: keyof typeof GLOSSARY | string;
  term?: string;
  text?: string;
  className?: string;
}) {
  const entry = id ? GLOSSARY[id] : undefined;
  const title = term ?? entry?.term;
  const body = text ?? entry?.text;
  if (!body) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`What does ${title} mean?`}
          className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-accent/60 transition align-middle ${className ?? ""}`}
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 rounded-2xl p-3">
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      </PopoverContent>
    </Popover>
  );
}

export default InfoTip;
