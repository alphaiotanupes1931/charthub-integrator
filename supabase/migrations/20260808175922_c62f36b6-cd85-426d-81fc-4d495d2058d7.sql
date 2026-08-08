CREATE TABLE public.signal_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '60',
  grade TEXT NOT NULL,
  bias TEXT NOT NULL,
  confidence NUMERIC,
  strategy_id TEXT,
  entry NUMERIC NOT NULL,
  stop NUMERIC NOT NULL,
  tp1 NUMERIC NOT NULL,
  planned_r NUMERIC,
  status TEXT NOT NULL DEFAULT 'open',
  realized_r NUMERIC,
  resolved_at TIMESTAMP WITH TIME ZONE,
  taken BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_scores TO authenticated;
GRANT ALL ON public.signal_scores TO service_role;

ALTER TABLE public.signal_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own signal scores"
  ON public.signal_scores FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX signal_scores_user_created_idx ON public.signal_scores (user_id, created_at DESC);
CREATE INDEX signal_scores_open_idx ON public.signal_scores (status, created_at) WHERE status = 'open';

CREATE TRIGGER signal_scores_touch
  BEFORE UPDATE ON public.signal_scores
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();