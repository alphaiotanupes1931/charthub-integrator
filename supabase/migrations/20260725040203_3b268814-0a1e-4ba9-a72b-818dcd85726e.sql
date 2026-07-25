
CREATE TABLE public.leaderboard_opt_in (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  opted_in BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT handle_length CHECK (char_length(handle) BETWEEN 2 AND 24),
  CONSTRAINT handle_format CHECK (handle ~ '^[A-Za-z0-9_\-]+$')
);
CREATE UNIQUE INDEX leaderboard_handle_uniq ON public.leaderboard_opt_in (lower(handle));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leaderboard_opt_in TO authenticated;
GRANT ALL ON public.leaderboard_opt_in TO service_role;
ALTER TABLE public.leaderboard_opt_in ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own opt-in row" ON public.leaderboard_opt_in
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER leaderboard_opt_in_touch BEFORE UPDATE ON public.leaderboard_opt_in
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.get_public_leaderboard(_limit INT DEFAULT 50)
RETURNS TABLE(
  handle TEXT,
  equity NUMERIC,
  starting_balance NUMERIC,
  pnl_pct NUMERIC,
  trades BIGINT,
  wins BIGINT,
  win_rate NUMERIC,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.handle,
    a.balance AS equity,
    a.starting_balance,
    CASE WHEN a.starting_balance > 0
      THEN ROUND(((a.balance - a.starting_balance) / a.starting_balance) * 100, 2)
      ELSE 0 END AS pnl_pct,
    COALESCE(t.trades, 0) AS trades,
    COALESCE(t.wins, 0) AS wins,
    CASE WHEN COALESCE(t.trades, 0) > 0
      THEN ROUND((COALESCE(t.wins, 0)::NUMERIC / t.trades) * 100, 1)
      ELSE 0 END AS win_rate,
    a.updated_at
  FROM public.leaderboard_opt_in l
  JOIN public.paper_accounts a ON a.user_id = l.user_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::BIGINT AS trades,
           SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)::BIGINT AS wins
    FROM public.paper_trades pt WHERE pt.user_id = l.user_id
  ) t ON true
  WHERE l.opted_in = true
  ORDER BY pnl_pct DESC NULLS LAST, equity DESC
  LIMIT COALESCE(_limit, 50);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_leaderboard(INT) TO anon, authenticated;
