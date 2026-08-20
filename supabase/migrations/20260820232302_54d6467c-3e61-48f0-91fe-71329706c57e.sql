REVOKE EXECUTE ON FUNCTION public.admin_usage_today() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_usage_today() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_usage_today() TO authenticated;