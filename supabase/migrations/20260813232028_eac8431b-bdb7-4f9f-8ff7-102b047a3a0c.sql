-- Grant admin to terellebony@gmail.com
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::app_role FROM auth.users u
WHERE lower(u.email) = 'terellebony@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Admin-only role setter
CREATE OR REPLACE FUNCTION public.admin_set_user_role(_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _user_id = auth.uid() AND _role <> 'admin' THEN
    RAISE EXCEPTION 'You cannot remove your own admin role';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;

  IF _role = 'admin' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role) TO authenticated;

-- Include role in the admin users overview
DROP FUNCTION IF EXISTS public.admin_users_overview();
CREATE OR REPLACE FUNCTION public.admin_users_overview()
RETURNS TABLE(id uuid, email text, display_name text, referral_source text, onboarded boolean, created_at timestamp with time zone, broker_connected boolean, broker_name text, broker_account_type text, banned boolean, role text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
      p.broker_account_type,
      COALESCE(p.banned, false),
      CASE WHEN EXISTS (
        SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin'
      ) THEN 'admin' ELSE 'user' END::TEXT
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    ORDER BY p.created_at DESC NULLS LAST;
END;
$$;