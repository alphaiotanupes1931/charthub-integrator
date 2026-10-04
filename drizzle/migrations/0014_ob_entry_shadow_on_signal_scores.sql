ALTER TABLE public.signal_scores
  ADD COLUMN IF NOT EXISTS ob_shadow_entry numeric,
  ADD COLUMN IF NOT EXISTS ob_shadow_stop numeric,
  ADD COLUMN IF NOT EXISTS ob_shadow_label text,
  ADD COLUMN IF NOT EXISTS ob_shadow_r numeric;
COMMENT ON COLUMN public.signal_scores.ob_shadow_entry IS 'Shadow only: entry at the 15m order block inside the 1H order block (or the 1H block edge). Never traded.';
COMMENT ON COLUMN public.signal_scores.ob_shadow_r IS 'Shadow only: net R the order-block entry would have made against the same target. Null when it never filled.';