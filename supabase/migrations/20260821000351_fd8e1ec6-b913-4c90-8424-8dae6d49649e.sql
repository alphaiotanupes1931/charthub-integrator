GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_referral_stats() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_users_overview() FROM anon;