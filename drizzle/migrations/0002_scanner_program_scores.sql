-- Shadow record of every graded scan under Scanner Program v1. Two jobs:
-- it is the rolling 90-day distribution the percentile bands are measured
-- against, and it is how the drop in published signal volume can be measured
-- before the program becomes the published grade.
create table if not exists public.scanner_program_scores (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  instrument_class text not null,
  timeframe text not null,
  bias text not null,
  composite numeric not null,
  percentile numeric,
  band text not null,
  raw_band text not null,
  tier text not null,
  legacy_grade text not null,
  published_grade text,
  lower_bound_r numeric,
  net_r numeric,
  cost_r numeric,
  sample_size integer not null default 0,
  families jsonb not null default '{}'::jsonb,
  vetoes jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  shadow boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists scanner_program_scores_class_created_idx
  on public.scanner_program_scores (instrument_class, created_at desc);
create index if not exists scanner_program_scores_created_idx
  on public.scanner_program_scores (created_at desc);

grant select on public.scanner_program_scores to authenticated;
grant all on public.scanner_program_scores to service_role;

alter table public.scanner_program_scores enable row level security;

-- Admin-only reads: this is calibration data, not user data. Writes happen with
-- the service role from the scanner itself.
create policy "Admins read scanner program scores"
  on public.scanner_program_scores
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));