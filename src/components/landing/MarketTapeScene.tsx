import { useEffect, useRef, useState } from "react";

/**
 * Landing-page backdrop: an unmistakably trading visual.
 *
 * A live-looking candlestick tape scrolls right to left over a faint price
 * grid, with a moving average line, a blinking last-price marker and a
 * horizontal "level" line, the way a chart actually reads. Pure 2D canvas so
 * it costs almost nothing and never blocks the hero copy.
 */

const BG = "#05070a";
const GRID = "rgba(224, 182, 79, 0.07)";
const BULL = "#3ecf8e";
const BEAR = "#e2563c";
const GOLD = "#e0b64f";

type Candle = { o: number; h: number; l: number; c: number };

const CANDLE_W = 9;
const GAP = 5;
const STEP = CANDLE_W + GAP;

function nextCandle(prev: Candle, rand: () => number): Candle {
  const o = prev.c;
  const drift = (rand() - 0.48) * 0.9;
  const body = drift * (0.6 + rand() * 1.2);
  const c = o + body;
  const wick = (0.3 + rand() * 1.1) * 0.8;
  return { o, c, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick };
}

export function MarketTapeScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setMounted(true);
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(rm.matches);
    sync();
    rm.addEventListener("change", sync);
    return () => rm.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!mounted || reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let seed = 20260904;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    let width = 0;
    let height = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const candles: Candle[] = [{ o: 0, h: 0.8, l: -0.8, c: 0.2 }];
    const target = Math.ceil(window.innerWidth / STEP) + 4;
    while (candles.length < target) candles.push(nextCandle(candles[candles.length - 1], rand()));

    let offset = 0;
    let raf = 0;
    let last = performance.now();
    let paused = document.hidden;
    const onVis = () => {
      paused = document.hidden;
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVis);

    const draw = (now: number) => {
      const dt = Math.min(now - last, 60) / 1000;
      last = now;
      if (!paused) {
        offset += dt * 22; // px/sec scroll speed
        while (offset >= STEP) {
          offset -= STEP;
          candles.push(nextCandle(candles[candles.length - 1], rand()));
          const needed = Math.ceil(width / STEP) + 4;
          while (candles.length > needed) candles.shift();
        }
      }

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, width, height);

      // Price scale from the visible window.
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of candles) {
        if (c.l < lo) lo = c.l;
        if (c.h > hi) hi = c.h;
      }
      const pad = (hi - lo) * 0.35 || 1;
      lo -= pad;
      hi += pad;
      const plotTop = height * 0.18;
      const plotH = height * 0.64;
      const y = (v: number) => plotTop + plotH - ((v - lo) / (hi - lo)) * plotH;

      // Grid
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) {
        const gy = Math.round(plotTop + (plotH / 6) * i) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
        ctx.stroke();
      }
      for (let gx = -offset; gx < width; gx += STEP * 8) {
        ctx.beginPath();
        ctx.moveTo(Math.round(gx) + 0.5, plotTop);
        ctx.lineTo(Math.round(gx) + 0.5, plotTop + plotH);
        ctx.stroke();
      }

      // Candles
      candles.forEach((c, i) => {
        const x = i * STEP - offset;
        if (x < -STEP || x > width + STEP) return;
        const up = c.c >= c.o;
        const color = up ? BULL : BEAR;
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + CANDLE_W / 2, y(c.h));
        ctx.lineTo(x + CANDLE_W / 2, y(c.l));
        ctx.stroke();
        const top = y(Math.max(c.o, c.c));
        const bodyH = Math.max(1.5, Math.abs(y(c.o) - y(c.c)));
        ctx.fillStyle = color;
        ctx.globalAlpha = up ? 0.5 : 0.45;
        ctx.fillRect(x, top, CANDLE_W, bodyH);
        ctx.globalAlpha = 1;
      });

      // Moving average through the closes
      ctx.strokeStyle = GOLD;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const span = 8;
      candles.forEach((_, i) => {
        if (i < span) return;
        let sum = 0;
        for (let k = i - span; k < i; k++) sum += candles[k].c;
        const avg = sum / span;
        const px = i * STEP - offset + CANDLE_W / 2;
        if (i === span) ctx.moveTo(px, y(avg));
        else ctx.lineTo(px, y(avg));
      });
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Last price level line + marker
      const lastC = candles[candles.length - 1];
      const ly = y(lastC.c);
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = "rgba(224,182,79,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(width, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      const pulse = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(now / 420));
      ctx.fillStyle = `rgba(224,182,79,${pulse.toFixed(3)})`;
      const mx = (candles.length - 1) * STEP - offset + CANDLE_W / 2;
      ctx.beginPath();
      ctx.arc(Math.min(mx, width - 6), ly, 3.5, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mounted, reduced]);

  return (
    <div className="fixed inset-0 -z-10" style={{ background: BG }} aria-hidden>
      {mounted && !reduced && <canvas ref={canvasRef} className="absolute inset-0" />}
      {/* Readability scrim so hero copy stays legible over the tape. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 18% 45%, rgba(5,7,10,0.92) 0%, rgba(5,7,10,0.66) 38%, rgba(5,7,10,0.3) 70%, rgba(5,7,10,0.12) 100%)",
        }}
      />
    </div>
  );
}
