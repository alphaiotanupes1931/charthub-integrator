import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { prepareCoachTrade, confirmCoachTrade } from "@/lib/coach-actions.functions";
import { coachPlanSchema } from "@/lib/coach-actions.shared";
import type { ChartGrade } from "@/lib/chartAnnotations";

export function CoachTradeAction({ grade, symbol, timeframe }: { grade: ChartGrade; symbol?: string; timeframe?: string }) {
  const prepare = useServerFn(prepareCoachTrade);
  const confirm = useServerFn(confirmCoachTrade);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<Awaited<ReturnType<typeof prepareCoachTrade>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledge, setAcknowledge] = useState(false);
  const [message, setMessage] = useState("");
  const [used, setUsed] = useState(false);
  const plan = coachPlanSchema.safeParse({ symbol, timeframe, side: grade.bias, grade: grade.grade?.toUpperCase(),
    entry: grade.entry, stop: grade.stop, target: grade.tp1 });
  if (!plan.success) return null;
  const read = async () => {
    setOpen(true); setBusy(true); setMessage(""); setReview(null); setAcknowledge(false); setUsed(false);
    try { setReview(await prepare({ data: plan.data })); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Account could not be checked."); }
    finally { setBusy(false); }
  };
  const place = async () => {
    if (!review || busy || used) return;
    setBusy(true); setUsed(true);
    try {
      const result = await confirm({ data: { token: review.token, confirmed: true, acknowledgeLive: acknowledge } });
      setMessage(result.detail);
      await Promise.all([qc.invalidateQueries({ queryKey: ["broker-snapshot"] }), qc.invalidateQueries({ queryKey: ["journal"] }), qc.invalidateQueries({ queryKey: ["autopilot"] })]);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Check your broker for the order outcome."); }
    finally { setBusy(false); }
  };
  return <>
    <Button size="sm" variant="outline" onClick={() => void read()}><ArrowRight /> Review trade</Button>
    <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Confirm coach trade</DialogTitle><DialogDescription>{review?.live ? "Real-money account. Losses are possible." : "Review the account and protected market order."}</DialogDescription></DialogHeader>
        {busy && !review && <p className="text-sm text-muted-foreground">Checking account and trading limits…</p>}
        {review && <div className="space-y-4 text-sm">
          <div><p className="font-semibold">{review.account.broker === "tradelocker" ? "TradeLocker" : "OANDA"} · {review.live ? "Live / real money" : "Demo / practice"}</p><p className="text-muted-foreground break-all">Account {review.account.accountId} · Connection {review.account.env}</p></div>
          <dl className="grid grid-cols-2 gap-2">
            <dt className="text-muted-foreground">Market order</dt><dd>{review.plan.side === "long" ? "Buy" : "Sell"} {review.plan.symbol}</dd>
            <dt className="text-muted-foreground">Planned entry</dt><dd>{review.plan.entry}</dd>
            <dt className="text-muted-foreground">Stop loss</dt><dd>{review.plan.stop}</dd>
            <dt className="text-muted-foreground">Take profit</dt><dd>{review.plan.target}</dd>
            <dt className="text-muted-foreground">Size</dt><dd>{review.units} units</dd>
            <dt className="text-muted-foreground">Planned risk</dt><dd>{review.riskAmount.toFixed(2)} {review.currency} · {review.riskPct}%</dd>
          </dl>
          <p className="text-xs text-muted-foreground">Market fills and losses can differ from the plan. Review expires in five minutes.</p>
          {review.live && <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} /><span>I authorize this trade on this real-money account.</span></label>}
          <Button disabled={busy || used || (review.live && !acknowledge)} onClick={() => void place()} className="w-full">{busy ? <Loader2 className="animate-spin" /> : null}{used && !busy ? "Confirmation used" : "Confirm trade"}</Button>
        </div>}
        {message && <p role="status" className="text-sm break-words">{message}</p>}
      </DialogContent>
    </Dialog>
  </>;
}