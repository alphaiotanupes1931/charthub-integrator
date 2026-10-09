import { useEffect, useMemo, useState } from "react";
import { Check, X, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { nameChoices, nextCard, recordAnswer, type Bias, type PatternCard } from "@/lib/pattern-flashcards";
import type { AnalysisModelId } from "@/lib/analysis-models";
import { cn } from "@/lib/utils";

const KEY = "tm_pattern_cards";
type Store = { seen: string[]; missed: string[]; right: number; total: number };
const load = (): Store => {
  try { return { seen: [], missed: [], right: 0, total: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { seen: [], missed: [], right: 0, total: 0 }; }
};

function CardChart({ card }: { card: PatternCard }) {
  const W = 360, H = 170, pad = 10;
  const hi = Math.max(...card.bars.map((b) => b.h));
  const lo = Math.min(...card.bars.map((b) => b.l));
  const y = (v: number) => pad + ((hi - v) / Math.max(1e-9, hi - lo)) * (H - pad * 2);
  const step = W / card.bars.length;
  const bw = Math.max(4, step * 0.55);
  const [a, b] = card.highlight;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Pattern to name">
      <rect x={a * step} y={0} width={(b - a + 1) * step} height={H} className="fill-primary/10" />
      {card.bars.map((bar, i) => {
        const x = i * step + step / 2;
        const cls = bar.c >= bar.o ? "stroke-bull fill-bull" : "stroke-bear fill-bear";
        return (
          <g key={i} className={cls}>
            <line x1={x} x2={x} y1={y(bar.h)} y2={y(bar.l)} strokeWidth={1.5} />
            <rect x={x - bw / 2} y={y(Math.max(bar.o, bar.c))} width={bw} height={Math.max(1.5, Math.abs(y(bar.o) - y(bar.c)))} />
          </g>
        );
      })}
    </svg>
  );
}

/** Quick visual flashcard before each scan: name the pattern, then call it. */
export function PreScanCheck({
  open, onCancel, onContinue,
}: {
  open: boolean;
  modelId: AnalysisModelId;
  symbol?: string;
  ticker?: string;
  interval?: string;
  timeframe?: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const [card, setCard] = useState<PatternCard | null>(null);
  const [seed, setSeed] = useState(0);
  const [store, setStore] = useState<Store>({ seen: [], missed: [], right: 0, total: 0 });
  const [namePick, setNamePick] = useState<string | null>(null);
  const [biasPick, setBiasPick] = useState<Bias | null>(null);

  useEffect(() => {
    if (!open) return;
    const s = load();
    const sd = Date.now();
    setStore(s);
    setSeed(sd);
    setCard(nextCard(s.seen, s.missed, sd));
    setNamePick(null);
    setBiasPick(null);
  }, [open]);

  const choices = useMemo(() => (card ? nameChoices(card, seed) : []), [card, seed]);
  const done = biasPick !== null;
  const right = !!card && done && namePick === card.name && biasPick === card.bias;

  const pickBias = (b: Bias) => {
    if (!card || done) return;
    setBiasPick(b);
    const ok = namePick === card.name && b === card.bias;
    const r = recordAnswer(store.seen, store.missed, card.id, ok);
    const next = { ...r, right: store.right + (ok ? 1 : 0), total: store.total + 1 };
    setStore(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md rounded-sm p-0 overflow-hidden">
        <div className="border-b border-border/60 px-5 py-3">
          <DialogHeader className="space-y-0.5">
            <DialogTitle className="flex items-center justify-between gap-2 pr-6 text-base font-semibold">
              <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" />Quick pattern check</span>
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{store.right}/{store.total}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">Name it, then call it.</DialogDescription>
          </DialogHeader>
        </div>

        {card && (
          <div className="space-y-3 px-5 py-4">
            <div className="rounded-sm border border-border/60 bg-background p-2"><CardChart card={card} /></div>

            {!namePick ? (
              <div className="grid grid-cols-2 gap-1.5">
                {choices.map((c) => (
                  <button key={c} type="button" onClick={() => setNamePick(c)}
                    className="rounded-sm border border-border/60 px-2 py-2 text-sm hover:border-primary/60">{c}</button>
                ))}
              </div>
            ) : !done ? (
              <div className="grid grid-cols-3 gap-1.5">
                {(["bullish", "bearish", "neutral"] as Bias[]).map((b) => (
                  <button key={b} type="button" onClick={() => pickBias(b)}
                    className="rounded-sm border border-border/60 px-2 py-2.5 text-sm font-medium capitalize hover:border-primary/60">{b}</button>
                ))}
              </div>
            ) : (
              <div className={cn("rounded-sm border p-3", right ? "border-primary/50 bg-primary/[0.06]" : "border-destructive/40 bg-destructive/[0.05]")}>
                <div className={cn("mb-1 flex items-center gap-1.5 text-[10px] tracking-[0.2em]", right ? "text-primary" : "text-destructive")}>
                  {right ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}{right ? "CORRECT" : "NOT QUITE"}
                </div>
                <p className="text-sm font-medium">{card.name} · <span className="capitalize">{card.bias}</span></p>
                <p className="mt-1 text-xs leading-relaxed text-foreground/90">{card.why}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
          <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          <Button size="sm" className="rounded-sm" onClick={onContinue} disabled={!!card && !done}>
            {card && !done ? "Answer to continue" : "Run the scan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
