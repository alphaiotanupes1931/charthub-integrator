import { memo, useEffect, useState } from "react";
import { useTimezone, TIMEZONE_OPTIONS, AUTO_TZ } from "@/hooks/useTimezone";

/** Exchange-style clock: moving analog dial, digital time, date and which market centres are open. */
const CENTRES = [
  { name: "Sydney", tz: "Australia/Sydney", open: 7, close: 16 },
  { name: "Tokyo", tz: "Asia/Tokyo", open: 9, close: 18 },
  { name: "London", tz: "Europe/London", open: 8, close: 17 },
  { name: "New York", tz: "America/New_York", open: 8, close: 17 },
];

/** Intl.DateTimeFormat construction is expensive — cache one instance per time zone. */
const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string) {
  let f = partsFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsFmtCache.set(tz, f);
  }
  return f;
}
const timeFmtCache = new Map<string, Intl.DateTimeFormat>();
function timeFmt(tz: string) {
  let f = timeFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit" });
    timeFmtCache.set(tz, f);
  }
  return f;
}
const dateFmtCache = new Map<string, Intl.DateTimeFormat>();
function dateFmt(tz: string) {
  let f = dateFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
    dateFmtCache.set(tz, f);
  }
  return f;
}
const zoneFmtCache = new Map<string, Intl.DateTimeFormat>();
function zoneFmt(tz: string) {
  let f = zoneFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });
    zoneFmtCache.set(tz, f);
  }
  return f;
}

function partsIn(tz: string, d: Date) {
  const p = partsFmt(tz).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "0";
  return { h: Number(g("hour")) % 24, m: Number(g("minute")), s: Number(g("second")), wd: g("weekday") };
}

export function isCentreOpen(c: (typeof CENTRES)[number], d: Date): boolean {
  const { h, wd } = partsIn(c.tz, d);
  if (wd === "Sat" || wd === "Sun") return false;
  return h >= c.open && h < c.close;
}

const hand = (deg: number, len: number, w: number, cls: string) => (
  <line x1="50" y1="50" x2="50" y2={50 - len} strokeWidth={w} strokeLinecap="round" className={cls} transform={`rotate(${deg} 50 50)`} />
);

/**
 * Analog dial. Only this tiny component updates per animation frame, so the
 * second hand sweeps smoothly without re-rendering the rest of the clock.
 */
const AnalogDial = memo(function AnalogDial({ tz }: { tz: string }) {
  const [angles, setAngles] = useState<{ hr: number; min: number; sec: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const d = new Date();
      const { h, m, s } = partsIn(tz, d);
      const sec = s + d.getMilliseconds() / 1000;
      setAngles({ hr: ((h % 12) + m / 60) * 30, min: (m + sec / 60) * 6, sec: sec * 6 });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tz]);

  return (
    <svg viewBox="0 0 100 100" className="h-11 w-11 shrink-0" aria-hidden>
      <circle cx="50" cy="50" r="47" className="fill-card stroke-border" strokeWidth="2" />
      {Array.from({ length: 12 }).map((_, i) => (
        <line key={i} x1="50" y1="7" x2="50" y2={i % 3 === 0 ? 15 : 11} strokeWidth={i % 3 === 0 ? 3 : 1.5} className="stroke-muted-foreground" transform={`rotate(${i * 30} 50 50)`} />
      ))}
      {angles && (
        <>
          {hand(angles.hr, 24, 5, "stroke-foreground")}
          {hand(angles.min, 35, 3.5, "stroke-foreground")}
          {hand(angles.sec, 40, 1.5, "stroke-primary")}
        </>
      )}
      <circle cx="50" cy="50" r="3.5" className="fill-primary" />
    </svg>
  );
});

export function MarketClock({ className = "" }: { className?: string }) {
  const { timezone, effectiveTimezone, setTimezone } = useTimezone();
  const tz = effectiveTimezone || "UTC";
  const [now, setNow] = useState<Date | null>(null);
  /** Device clock minus server clock, in ms. Null until checked. */
  const [drift, setDrift] = useState<number | null>(null);

  useEffect(() => {
    const t0 = Date.now();
    fetch("/api/time", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { now: number }) => {
        const rtt = Date.now() - t0;
        setDrift(Date.now() - (j.now + rtt / 2));
      })
      .catch(() => {});
  }, []);

  // Digital time, date, zone label and open/closed status change at most once
  // per second, so a 1s interval is enough — no per-frame re-renders here.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <div className={`h-12 ${className}`} />;

  const time = timeFmt(tz).format(now);
  const date = dateFmt(tz).format(now);
  const zone = zoneFmt(tz).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? tz;

  return (
    <div className={`flex items-center gap-3 sm:gap-4 ${className}`} data-testid="market-clock">
      <AnalogDial tz={tz} />
      <div className="min-w-0 leading-tight">
        <div className="font-mono text-base font-semibold tabular-nums sm:text-lg" data-testid="market-clock-time">
          {time}{" "}
          <label className="relative inline-flex items-center">
            <span className="sr-only">Time zone</span>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              data-testid="market-clock-zone"
              title="Change time zone"
              className="cursor-pointer appearance-none rounded-sm border border-border/60 bg-background py-0 pl-1.5 pr-4 text-[10px] font-medium text-muted-foreground hover:border-primary/60 hover:text-foreground focus:outline-none"
            >
              {TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value === timezone ? (o.value === AUTO_TZ ? `${zone} (auto)` : zone) : o.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1 text-[8px] text-muted-foreground">▾</span>
          </label>
        </div>
        <div className="truncate text-[11px] text-muted-foreground" data-testid="market-clock-date">
          {date}
          {drift !== null && (
            <span data-testid="market-clock-check" className={Math.abs(drift) > 60_000 ? "ml-2 text-destructive" : "ml-2 text-bull"}>
              {Math.abs(drift) > 60_000
                ? `Your device clock is ${Math.round(Math.abs(drift) / 60_000)} min ${drift > 0 ? "fast" : "slow"}`
                : "Clock verified"}
            </span>
          )}
        </div>
      </div>
      <div className="ml-auto hidden items-center gap-3 md:flex">
        {CENTRES.map((c) => {
          const open = isCentreOpen(c, now);
          return (
            <span key={c.name} className="flex items-center gap-1.5 text-[11px]">
              <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-bull animate-pulse" : "bg-muted-foreground/40"}`} />
              <span className={open ? "text-foreground" : "text-muted-foreground"}>{c.name}</span>
              <span className="text-[10px] text-muted-foreground">{open ? "open" : "closed"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
