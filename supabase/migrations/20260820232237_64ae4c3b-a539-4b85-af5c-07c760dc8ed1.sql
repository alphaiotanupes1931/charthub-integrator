CREATE OR REPLACE FUNCTION public.admin_usage_today()
RETURNS TABLE(user_id uuid, requests integer, screenshots integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT a.user_id, a.count::INTEGER, COALESCE(a.image_count, 0)::INTEGER
    FROM public.ai_usage a
    WHERE a.day = (now() AT TIME ZONE 'utc')::date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_usage_today() TO authenticated;