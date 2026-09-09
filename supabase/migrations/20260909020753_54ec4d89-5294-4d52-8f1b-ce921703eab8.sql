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
    AND l.user_id IS NOT NULL
  GROUP BY l.kind, l.model
  ORDER BY 7 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_ai_cost_summary(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_cost_summary(INTEGER) TO authenticated, service_role;