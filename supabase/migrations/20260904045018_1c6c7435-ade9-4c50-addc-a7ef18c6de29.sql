CREATE TABLE public.instrument_profiles (
  symbol TEXT NOT NULL PRIMARY KEY,
  bars_sampled INTEGER NOT NULL DEFAULT 0,
  lookback TEXT NOT NULL DEFAULT '2y',
  atr_4h NUMERIC NOT NULL DEFAULT 0,
  atr_pct NUMERIC NOT NULL DEFAULT 0,
  median_pullback NUMERIC NOT NULL DEFAULT 0.5,
  deep_pullback NUMERIC NOT NULL DEFAULT 0.75,
  best_session TEXT NOT NULL DEFAULT 'newyork',
  sessions JSONB NOT NULL DEFAULT '[]'::jsonb,
  entry_buffer NUMERIC,
  stop_buffer_atr NUMERIC,
  max_entry_distance_atr NUMERIC,
  min_rr NUMERIC,
  tuned BOOLEAN NOT NULL DEFAULT false,
  tune_reason TEXT,
  source TEXT,
  measured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.instrument_profiles TO authenticated;
GRANT ALL ON public.instrument_profiles TO service_role;

ALTER TABLE public.instrument_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read instrument profiles"
  ON public.instrument_profiles FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_instrument_profiles_updated_at
  BEFORE UPDATE ON public.instrument_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();