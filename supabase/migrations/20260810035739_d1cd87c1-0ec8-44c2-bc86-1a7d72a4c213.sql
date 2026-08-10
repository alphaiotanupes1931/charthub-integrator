CREATE TABLE public.ai_cost_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX ai_cost_log_created_idx ON public.ai_cost_log (created_at DESC);
CREATE INDEX ai_cost_log_user_idx ON public.ai_cost_log (user_id, created_at DESC);

GRANT SELECT ON public.ai_cost_log TO authenticated;
GRANT ALL ON public.ai_cost_log TO service_role;

ALTER TABLE public.ai_cost_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own AI cost rows" ON public.ai_cost_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.admin_ai_cost_summary(_days INTEGER DEFAULT 30)
RETURNS TABLE(
  kind TEXT,
  model TEXT,
  calls BIGINT,
  input_tokens BIGINT,
  cached_input_tokens BIGINT,
  output_tokens BIGINT,
  cost_usd NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT l.kind, l.model, COUNT(*)::BIGINT,
         SUM(l.input_tokens)::BIGINT,
         SUM(l.cached_input_tokens)::BIGINT,
         SUM(l.output_tokens)::BIGINT,
         ROUND(SUM(l.cost_usd), 4)
  FROM public.ai_cost_log l
  WHERE l.created_at > now() - (COALESCE(_days, 30) || ' days')::interval
  GROUP BY l.kind, l.model
  ORDER BY 7 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ai_cost_per_user(_days INTEGER DEFAULT 30, _limit INTEGER DEFAULT 50)
RETURNS TABLE(
  user_id UUID,
  email TEXT,
  calls BIGINT,
  graded_setups BIGINT,
  cost_usd NUMERIC,
  cost_per_setup NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT l.user_id,
         u.email::TEXT,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE l.kind IN ('scan','grade','analyst','planner'))::BIGINT,
         ROUND(SUM(l.cost_usd), 4),
         CASE WHEN COUNT(*) FILTER (WHERE l.kind IN ('scan','grade','analyst','planner')) > 0
              THEN ROUND(SUM(l.cost_usd) / COUNT(*) FILTER (WHERE l.kind IN ('scan','grade','analyst','planner')), 4)
              ELSE NULL END
  FROM public.ai_cost_log l
  LEFT JOIN auth.users u ON u.id = l.user_id
  WHERE l.created_at > now() - (COALESCE(_days, 30) || ' days')::interval
  GROUP BY l.user_id, u.email
  ORDER BY 5 DESC
  LIMIT COALESCE(_limit, 50);
END;
$$;