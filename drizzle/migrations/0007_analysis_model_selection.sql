ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS analysis_model TEXT NOT NULL DEFAULT 'classic';

ALTER TABLE public.signal_scores ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE public.signal_scores ADD COLUMN IF NOT EXISTS model_version TEXT NOT NULL DEFAULT 'classic-1.0';

CREATE INDEX IF NOT EXISTS signal_scores_model_id_idx ON public.signal_scores (model_id, created_at DESC);