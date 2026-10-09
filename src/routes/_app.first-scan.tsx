import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getFirstScanSetup, trackFirstScan, skipFirstScan, type FirstScanSetup } from "@/lib/first-scan.functions";
import { track } from "@/lib/product-events";

export const Route = createFileRoute("/_app/first-scan")({
  head: () => ({
    meta: [
      { title: "Your First Scan | TradeMind" },
      { name: "description", content: "See a live TradeMind scan and track it in your journal in under a minute." },
      { property: "og:title", content: "Your First Scan | TradeMind" },
      { property: "og:description", content: "See a live TradeMind scan and track it in your journal in under a minute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: FirstScanPage,
});

const STEPS = [
  { key: "grade", title: "The grade", body: "A and B are the setups worth your attention. C and D are usually a pass." },
  { key: "entry", title: "The entry", body: "Only get in if price reaches this level. If it never does, there is no trade." },
  { key: "stop", title: "The stop", body: "Where the idea is wrong. Set it before you enter and do not move it further away." },
  { key: "target", title: "The target", body: "Where you take profit. TradeMind sizes it against the stop so wins pay more than losses." },
] as const;

function FirstScanPage() {
  const navigate = useNavigate();
  const getSetup = useServerFn(getFirstScanSetup);
  const trackFn = useServerFn(trackFirstScan);
  const skipFn = useServerFn(skipFirstScan);
  const [setup, setSetup] = useState<FirstScanSetup | null | undefined>(undefined);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    track("first_scan_viewed");
    getSetup().then((r) => setSetup(r.setup)).catch(() => setSetup(null));
  }, [getSetup]);

  const finish = () => window.location.assign("/dashboard");
  const done = step >= STEPS.length;
  const active = STEPS[Math.min(step, STEPS.length - 1)].key;

  async function onTrack() {
    if (!setup) return;
    setBusy(true);
    try {
      await trackFn({ data: { symbol: setup.symbol, grade: setup.grade, direction: setup.direction, entry: setup.entry, stop: setup.stop, target: setup.target } });
      track("first_scan_tracked", { symbol: setup.symbol, grade: setup.grade });
      toast.success("Tracking it in your journal. Check back to see how it played out.");
      finish();
    } catch {
      toast.error("Could not save it. Try again.");
      setBusy(false);
    }
  }

  async function onSkip() {
    await skipFn().catch(() => undefined);
    track("first_scan_skipped");
    finish();
  }

  const cell = (key: string, label: string, value: string) => (
    <div className={`rounded-2xl border p-4 transition ${!done && active === key ? "border-primary bg-primary/10 ring-2 ring-primary/40" : "border-border/60 bg-card/60"}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <p className="text-sm text-primary font-medium">Step 1 of your first week</p>
      <h1 className="mt-1 text-2xl font-bold">Your first scan</h1>
      <p className="mt-2 text-muted-foreground">This is a live setup from the scanner. Here is how to read it in four taps.</p>

      {setup === undefined && <div className="mt-6 h-64 animate-pulse rounded-2xl bg-muted/40" />}

      {setup === null && (
        <div className="mt-6 rounded-2xl border border-border/60 p-5">
          <p>The scanner has no fresh setup right now, which usually means markets are quiet. Run a scan from your dashboard any time.</p>
          <Button className="mt-4" onClick={onSkip}>Go to my dashboard</Button>
        </div>
      )}

      {setup && (
        <>
          <div className="mt-6 flex items-center justify-between">
            <div className="text-lg font-semibold">{setup.symbol} <span className="text-muted-foreground font-normal">{setup.direction}</span></div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {cell("grade", "Grade", setup.grade)}
            {cell("entry", "Entry", String(setup.entry))}
            {cell("stop", "Stop", String(setup.stop))}
            {cell("target", "Target", String(setup.target))}
          </div>

          {!done ? (
            <div className="mt-5 rounded-2xl border border-primary/40 bg-primary/5 p-4">
              <div className="font-semibold">{STEPS[step].title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{STEPS[step].body}</p>
              <Button className="mt-3" onClick={() => setStep((s) => s + 1)}>{step === STEPS.length - 1 ? "Got it" : "Next"}</Button>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-border/60 p-4">
              <div className="font-semibold">Track this setup</div>
              <p className="mt-1 text-sm text-muted-foreground">We save it to your journal with these levels locked and mark it win or loss automatically. No money is used.</p>
              <Button className="mt-3 w-full" disabled={busy} onClick={onTrack}>{busy ? "Saving..." : "Track this setup"}</Button>
            </div>
          )}
          <button className="mt-4 text-sm text-muted-foreground underline" onClick={onSkip}>Skip for now</button>
        </>
      )}
    </div>
  );
}
