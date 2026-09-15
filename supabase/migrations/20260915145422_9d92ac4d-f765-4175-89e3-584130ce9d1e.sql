alter table public.signal_scores
  add column if not exists mae_r numeric,
  add column if not exists bars_to_resolve integer;

comment on column public.signal_scores.mae_r is 'Maximum adverse excursion in R before the signal resolved: the measurement of how early the entry fired.';
comment on column public.signal_scores.bars_to_resolve is 'Bars from filing to resolution.';