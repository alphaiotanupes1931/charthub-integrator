alter table public.signal_scores
  add column if not exists net_r numeric,
  add column if not exists cost_r numeric;

comment on column public.signal_scores.net_r is 'Realised R after spread and slippage. Gross realized_r is kept alongside it.';
comment on column public.signal_scores.cost_r is 'Round-turn trading cost for this signal expressed in R.';