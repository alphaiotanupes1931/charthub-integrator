ALTER TABLE public.scan_log ADD COLUMN IF NOT EXISTS autopilot_proposal_id uuid REFERENCES public.autopilot_proposals(id) ON DELETE SET NULL;
ALTER TABLE public.scan_log ADD COLUMN IF NOT EXISTS hypothetical_risk_amount numeric;
CREATE UNIQUE INDEX IF NOT EXISTS scan_log_autopilot_proposal ON public.scan_log(autopilot_proposal_id) WHERE autopilot_proposal_id IS NOT NULL;

INSERT INTO public.scan_log(user_id, created_at, source, symbol, timeframe, bias, grade, confidence, entry, stop, tp1, reason, status, taken, taken_at, refused_reason, autopilot_proposal_id)
SELECT p.user_id, p.created_at, 'autopilot', p.symbol, p.timeframe,
  CASE WHEN p.side = 'long' THEN 'Long' ELSE 'Short' END, COALESCE(p.grade, 'NO ENTRY'), p.confidence,
  p.entry, p.stop_loss, p.take_profit, p.reasoning,
  CASE WHEN p.entry > 0 AND p.stop_loss > 0 AND p.take_profit > 0 THEN 'open' ELSE 'no_trade' END,
  p.status = 'filled', CASE WHEN p.status = 'filled' THEN p.decided_at ELSE NULL END,
  COALESCE(p.rejection_reason, CASE WHEN p.status = 'pending' THEN 'Waiting for entry confirmation' ELSE NULL END), p.id
FROM public.autopilot_proposals p
WHERE NOT EXISTS (SELECT 1 FROM public.scan_log s WHERE s.autopilot_proposal_id = p.id);