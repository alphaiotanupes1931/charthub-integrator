ALTER TABLE public.signal_scores
  ADD COLUMN IF NOT EXISTS seq_shadow_entry numeric,
  ADD COLUMN IF NOT EXISTS seq_shadow_stop numeric,
  ADD COLUMN IF NOT EXISTS seq_shadow_target numeric,
  ADD COLUMN IF NOT EXISTS seq_shadow_status text,
  ADD COLUMN IF NOT EXISTS seq_shadow_label text,
  ADD COLUMN IF NOT EXISTS seq_session_phase text,
  ADD COLUMN IF NOT EXISTS seq_h1_phase text,
  ADD COLUMN IF NOT EXISTS seq_shadow_r numeric;
COMMENT ON COLUMN public.signal_scores.seq_shadow_r IS 'Shadow only: net R of the full session/sweep/BOS/retest/15m-OB sequence entry. Null when no entry or never filled.';