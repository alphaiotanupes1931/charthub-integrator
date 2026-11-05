CREATE TABLE public.liquidity_draw_state (
 symbol text NOT NULL,
 feed text NOT NULL,
 version integer NOT NULL DEFAULT 0,
 processed_time bigint NOT NULL DEFAULT 0,
 state jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (symbol, feed)
);
GRANT SELECT ON public.liquidity_draw_state TO authenticated;
GRANT ALL ON public.liquidity_draw_state TO service_role;
ALTER TABLE public.liquidity_draw_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY liquidity_draw_read ON public.liquidity_draw_state FOR SELECT TO authenticated USING (true);
CREATE FUNCTION public.save_liquidity_draw(p_symbol text, p_feed text, p_version integer, p_time bigint, p_state jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE changed integer;
BEGIN
 INSERT INTO public.liquidity_draw_state(symbol, feed) VALUES(p_symbol, p_feed) ON CONFLICT DO NOTHING;
 UPDATE public.liquidity_draw_state SET state=p_state, processed_time=p_time, version=version+1, updated_at=now()
 WHERE symbol=p_symbol AND feed=p_feed AND version=p_version AND processed_time<=p_time;
 GET DIAGNOSTICS changed = ROW_COUNT;
 RETURN changed=1;
END;
$$;
REVOKE ALL ON FUNCTION public.save_liquidity_draw(text,text,integer,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_liquidity_draw(text,text,integer,bigint,jsonb) TO service_role;
ALTER TABLE public.scan_log ADD COLUMN IF NOT EXISTS liquidity_draw jsonb;
COMMENT ON TABLE public.liquidity_draw_state IS 'Shared market-only liquidity state scoped to symbol and exact feed; optimistic version prevents concurrent stale draw rewrites.';