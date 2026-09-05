import { Suspense, lazy, useEffect, useState } from "react";

/**
 * Landing-page backdrop: a smooth 3D candlestick skyline drifting toward the
 * viewer. The heavy WebGL scene is code-split and only mounts in the browser;
 * SSR and reduced-motion users get the static dark background.
 */

const BG = "#05070a";

const MarketTapeCanvas = lazy(() =>
  import("./MarketTapeCanvas").then((m) => ({ default: m.MarketTapeCanvas })),
);

export function MarketTapeScene() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) setReady(true);
  }, []);

  return (
    <div className="fixed inset-0 -z-10" style={{ background: BG }} aria-hidden>
      {ready && (
        <Suspense fallback={null}>
          <MarketTapeCanvas />
        </Suspense>
      )}
      {/* Readability scrim so hero copy stays legible over the scene. */}
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
