import { Clock } from "lucide-react";
import { useTimezone, formatInTimezone } from "@/hooks/useTimezone";

/**
 * Audit line for a scan card: the exact moment the market data was pulled and
 * the market price the plan was measured against. Traders use it to tell why a
 * grade differs from an earlier scan of the same instrument.
 */
export function ScanStamp({
  fetchedAt,
  refPrice,
  dataSource,
  candleCount,
  className,
}: {
  fetchedAt?: string;
  refPrice?: number;
  dataSource?: string;
  candleCount?: number;
  className?: string;
}) {
  const { effectiveTimezone } = useTimezone();

  const when = (() => {
    if (!fetchedAt) return null;
    const d = new Date(fetchedAt);
    if (isNaN(d.getTime())) return null;
    return formatInTimezone(d, effectiveTimezone, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  })();

  const price = (() => {
    if (typeof refPrice !== "number" || !isFinite(refPrice)) return null;
    const abs = Math.abs(refPrice);
    const dec = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
    return refPrice.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  })();

  if (!when && !price && !dataSource && candleCount === undefined) return null;

  const parts = [
    when ? `Scanned ${when}` : "Scan time unavailable",
    price ? `price used ${price}` : null,
    dataSource ?? null,
    candleCount !== undefined ? `${candleCount} bars` : null,
  ].filter(Boolean) as string[];

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] leading-tight text-muted-foreground ${className ?? ""}`}
      title="Grades are measured against the price and candles pulled at this moment. A later scan can grade differently if price has moved."
    >
      <Clock className="h-3 w-3 shrink-0" />
      <span>{parts.join(" · ")}</span>
    </span>
  );
}
