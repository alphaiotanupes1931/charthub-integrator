DROP POLICY IF EXISTS "liquidity_draw_read" ON public.liquidity_draw_state;
REVOKE SELECT ON public.liquidity_draw_state FROM anon, authenticated;