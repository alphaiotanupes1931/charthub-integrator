import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Crosshair, Check } from "lucide-react";
import {
  SCAN_LENSES,
  readActiveLensId,
  writeActiveLensId,
  type ScanLensId,
} from "@/lib/scanLens";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/scan-lens")({
  head: () => ({
    meta: [
      { title: "Scan Lens, TradeMind" },
      { name: "description", content: "Choose how the AI reads charts. The scan lens biases emphasis without breaking core Wyckoff grading." },
    ],
  }),
  component: ScanLensPage,
});

function ScanLensPage() {
  const [active, setActive] = useState<ScanLensId>("wyckoff");
  useEffect(() => { setActive(readActiveLensId()); }, []);

  function pick(id: ScanLensId) {
    setActive(id);
    writeActiveLensId(id);
    const lens = SCAN_LENSES.find((l) => l.id === id);
    toast.success(`Scan Lens set to ${lens?.name ?? id}`);
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center gap-3 mb-2">
        <Crosshair className="size-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Scan Lens</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8 max-w-xl">
        The lens controls how your AI coach reads charts. Wyckoff Sweep -&gt; BOS -&gt; Retest still runs on every scan — the lens only shifts emphasis, targets, and which setups get flagged off-playbook.
      </p>

      <div className="space-y-2.5">
        {SCAN_LENSES.map((l) => {
          const isActive = active === l.id;
          return (
            <button
              key={l.id}
              onClick={() => pick(l.id)}
              className={`w-full text-left rounded-xl border p-4 transition flex items-start gap-3 ${
                isActive
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-card/40 hover:border-border/80"
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${isActive ? "text-primary" : ""}`}>{l.name}</span>
                  {isActive && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-primary/40 text-primary">
                      <Check className="size-3" /> Active
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{l.desc}</p>
                <p className="text-xs text-muted-foreground/80 mt-2 italic leading-relaxed">
                  How the AI applies it: {l.promptEmphasis}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <p className="italic text-xs text-muted-foreground mt-6">
        Strategy is the lens, not the law. No lens overrides Wyckoff grading — Sweep -&gt; BOS -&gt; Retest is always required for A+ entries.
      </p>
    </div>
  );
}
