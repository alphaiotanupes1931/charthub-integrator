
DROP FUNCTION IF EXISTS public.admin_users_overview();

CREATE OR REPLACE FUNCTION public.admin_users_overview()
 RETURNS TABLE(id uuid, email text, display_name text, referral_source text, onboarded boolean, created_at timestamp with time zone, broker_connected boolean, broker_name text, broker_account_type text, banned boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE(p.banned, false)
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    ORDER BY p.created_at DESC NULLS LAST;
END;
$function$;
