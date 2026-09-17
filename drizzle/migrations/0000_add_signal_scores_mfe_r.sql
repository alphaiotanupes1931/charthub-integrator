alter table public.signal_scores
  add column if not exists mfe_r numeric;

comment on column public.signal_scores.mfe_r is 'Maximum favourable excursion in R before the signal resolved: separates a stop that was too tight from a direction that was wrong.';