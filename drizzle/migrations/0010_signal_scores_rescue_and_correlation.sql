ALTER TABLE public.signal_scores
  ADD COLUMN IF NOT EXISTS rescued boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correlated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correlation_cluster text;

CREATE INDEX IF NOT EXISTS signal_scores_cluster_idx
  ON public.signal_scores (user_id, correlation_cluster, created_at DESC);