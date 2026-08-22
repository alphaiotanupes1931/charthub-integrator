ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_model_pref TEXT NOT NULL DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_ai_model_pref_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_ai_model_pref_check
      CHECK (ai_model_pref IN ('auto', 'claude', 'fallback'));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.admin_users_overview();

CREATE FUNCTION public.admin_users_overview()
RETURNS TABLE(id uuid, email text, display_name text, referral_source text, onboarded boolean, created_at timestamp with time zone, broker_connected boolean, broker_name text, broker_account_type text, banned boolean, role text, ai_model_pref text)
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
      ) THEN 'admin' ELSE 'user' END::TEXT,
      COALESCE(p.ai_model_pref, 'auto')::TEXT
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    ORDER BY p.created_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_users_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_users_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_users_overview() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_ai_model_pref(_user_id uuid, _pref text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _pref NOT IN ('auto', 'claude', 'fallback') THEN
    RAISE EXCEPTION 'invalid model preference';
  END IF;
  UPDATE public.profiles SET ai_model_pref = _pref WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_ai_model_pref(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_model_pref(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_model_pref(uuid, text) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');