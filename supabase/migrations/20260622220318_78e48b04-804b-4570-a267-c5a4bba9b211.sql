DROP FUNCTION IF EXISTS public.admin_users_overview();

CREATE OR REPLACE FUNCTION public.admin_users_overview()
RETURNS TABLE(
  id UUID,
  email TEXT,
  display_name TEXT,
  referral_source TEXT,
  onboarded BOOLEAN,
  created_at TIMESTAMPTZ,
  broker_connected BOOLEAN,
  broker_name TEXT,
  broker_account_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT
      u.id,
      u.email::TEXT,
      p.display_name,
      p.referral_source,
      p.onboarded,
      p.created_at,
      p.broker_connected,
      p.broker_name,
      p.broker_account_type
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    ORDER BY p.created_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_users_overview() TO authenticated;
SELECT pg_notify('pgrst', 'reload schema');