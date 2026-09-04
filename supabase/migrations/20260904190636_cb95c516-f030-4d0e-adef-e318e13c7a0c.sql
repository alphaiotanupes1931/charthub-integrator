CREATE TABLE public.engine_replay_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  lookback text NOT NULL DEFAULT '2y',
  bars integer NOT NULL DEFAULT 0,
  from_ts timestamptz,
  to_ts timestamptz,
  trades integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  expectancy_r numeric NOT NULL DEFAULT 0,
  net_r numeric NOT NULL DEFAULT 0,
  profit_factor numeric,
  max_dd_pct numeric NOT NULL DEFAULT 0,
  a_trades integer NOT NULL DEFAULT 0,
  a_win_rate numeric NOT NULL DEFAULT 0,
  a_expectancy_r numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'replay',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, timeframe, lookback)
);

GRANT SELECT ON public.engine_replay_stats TO anon;
GRANT SELECT ON public.engine_replay_stats TO authenticated;
GRANT ALL ON public.engine_replay_stats TO service_role;

ALTER TABLE public.engine_replay_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Replay track record is public to read"
  ON public.engine_replay_stats FOR SELECT
  TO anon, authenticated
  USING (true);