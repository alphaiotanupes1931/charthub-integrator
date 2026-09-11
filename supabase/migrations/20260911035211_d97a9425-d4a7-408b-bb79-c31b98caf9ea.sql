DROP POLICY IF EXISTS "acceptor updates invite" ON public.trader_invites;
REVOKE UPDATE ON public.trader_invites FROM authenticated;

CREATE OR REPLACE FUNCTION public.get_social_roster(_user_id uuid)
RETURNS TABLE (
  id uuid,
  display_name text,
  wins integer,
  losses integer,
  connected_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.display_name,
    p.wins,
    p.losses,
    c.created_at
  FROM public.trader_connections c
  JOIN public.profiles p
    ON p.id = CASE WHEN c.user_a = _user_id THEN c.user_b ELSE c.user_a END
  WHERE (c.user_a = _user_id OR c.user_b = _user_id)
    AND p.id <> _user_id
  ORDER BY c.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_social_roster(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_roster(uuid) TO service_role;