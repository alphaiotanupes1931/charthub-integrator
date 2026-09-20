ALTER TABLE public.scanner_program_scores
  ADD COLUMN IF NOT EXISTS six_dimension jsonb;

COMMENT ON COLUMN public.scanner_program_scores.six_dimension IS
  'Shadow measurement of the taught six-dimension framework, recorded next to the published grade. Never used to publish a grade until validated on held-out resolved outcomes.';